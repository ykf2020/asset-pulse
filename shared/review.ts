import type { Account, Review, ReviewInput, Snapshot } from './model.js'
import { fxRateFor, previousSnapshotByAccount, sumTotals, toTwd } from './money.js'

export const CARRY_FORWARD_NOTE = '沿用上次'

export interface BuiltReview {
  review: Review
  snapshots: Snapshot[]
  /** 這次沒填、沿用上次金額的帳戶名稱，送出後回報給使用者 */
  carriedForward: string[]
}

export class ReviewBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReviewBuildError'
  }
}

export interface BuildReviewDeps {
  reviewId: string
  newSnapshotId: () => string
  createdAt: string
}

/**
 * 組出一次盤點要寫進 Sheet 的所有列。
 *
 * 重點：**每次盤點都會為「所有 active 帳戶」各留一筆 snapshot**。使用者在流程中
 * 略過的帳戶，自動沿用上一次的金額。這樣 `Reviews` 那一列的淨資產永遠是當天的
 * 完整狀態，不會因為某個帳戶沒填就少算一塊 —— 不然趨勢圖會在每次略過時掉一個洞。
 */
export function buildReview(
  input: ReviewInput,
  accounts: readonly Account[],
  existingSnapshots: readonly Snapshot[],
  deps: BuildReviewDeps,
): BuiltReview {
  const active = accounts.filter((a) => a.status === 'active')
  const byId = new Map(active.map((a) => [a.id, a]))

  for (const entry of input.entries) {
    if (!byId.has(entry.account_id)) {
      throw new ReviewBuildError(`帳戶 ${entry.account_id} 不存在或已封存`)
    }
  }

  const entryByAccount = new Map(input.entries.map((e) => [e.account_id, e]))
  const previous = previousSnapshotByAccount(existingSnapshots, input.date)

  const snapshots: Snapshot[] = []
  const carriedForward: string[] = []

  for (const account of active) {
    const entry = entryByAccount.get(account.id)
    const prev = previous.get(account.id)

    let amount: number
    let note: string

    if (entry) {
      amount = entry.amount
      note = entry.note
    } else if (prev) {
      amount = prev.amount
      note = CARRY_FORWARD_NOTE
      carriedForward.push(account.name)
    } else {
      continue // 從來沒填過、這次也沒填 → 還沒開始追蹤這個帳戶
    }

    snapshots.push({
      id: deps.newSnapshotId(),
      review_id: deps.reviewId,
      date: input.date,
      account_id: account.id,
      amount,
      currency: account.currency,
      fx_rate: fxRateFor(account.currency, input.usd_twd_rate),
      amount_twd: toTwd(amount, account.currency, input.usd_twd_rate),
      note,
      created_at: deps.createdAt,
    })
  }

  if (snapshots.length === 0) {
    throw new ReviewBuildError('這次盤點沒有任何有效的帳戶金額')
  }

  const totals = sumTotals(
    snapshots.map((s) => ({
      isLiability: byId.get(s.account_id)?.is_liability ?? false,
      amountTwd: s.amount_twd,
    })),
  )

  return {
    review: {
      id: deps.reviewId,
      date: input.date,
      usd_twd_rate: input.usd_twd_rate,
      total_assets_twd: totals.assets,
      total_liabilities_twd: totals.liabilities,
      net_worth_twd: totals.netWorth,
      note: input.note,
      created_at: deps.createdAt,
    },
    snapshots,
    carriedForward,
  }
}

/* ------------------------------------------------------------------ */
/* 併入當天已經存在的那一筆盤點                                          */
/* ------------------------------------------------------------------ */

export interface MergedReview {
  review: Review
  /** 併完之後，那次盤點完整的明細（拿來算總額、回給前端） */
  snapshots: Snapshot[]
  /** 需要就地更新的既有明細 id */
  changedIds: Set<string>
  /** 需要新增的明細列 */
  inserted: Snapshot[]
  /** 這次才補進來的帳戶名稱 */
  addedAccounts: string[]
}

export interface MergeReviewDeps {
  newSnapshotId: () => string
  createdAt: string
}

/**
 * 把一次送出併進同一天已經存在的盤點，而不是另外開一筆。
 *
 * 真實情境：早上盤點完，想起來還有一個帳戶忘了建，於是補建帳戶、再跑一次
 * 盤點流程，把已經填過的都跳過、只填新的那個。
 *
 * 關鍵在「跳過」的語意不一樣：
 *
 *   - 開新的一筆時，跳過 = 沿用**上一次**盤點的金額。
 *   - 併入當天那筆時，跳過 = 保留**當天已經填好**的金額。
 *
 * 這兩者差一個禮拜。如果併入時還去撈上一次的值，就會把今天剛填好的數字
 * 用上週的蓋掉 —— 而且使用者完全不會發現。
 *
 * 另外這個函式是冪等的：同樣的內容送兩次，結果一樣。離線佇列重送因此安全。
 */
export function mergeReview(
  input: ReviewInput,
  existing: Review,
  accounts: readonly Account[],
  allSnapshots: readonly Snapshot[],
  deps: MergeReviewDeps,
): MergedReview {
  const active = accounts.filter((a) => a.status === 'active')
  const byId = new Map(active.map((a) => [a.id, a]))

  for (const entry of input.entries) {
    if (!byId.has(entry.account_id)) {
      throw new ReviewBuildError(`帳戶 ${entry.account_id} 不存在或已封存`)
    }
  }

  const date = existing.date
  const rate = input.usd_twd_rate
  const mine = allSnapshots.filter((s) => s.review_id === existing.id)
  const mineByAccount = new Map(mine.map((s) => [s.account_id, s]))
  const entryByAccount = new Map(input.entries.map((e) => [e.account_id, e]))
  const previous = previousSnapshotByAccount(allSnapshots, date)

  const snapshots: Snapshot[] = []
  const changedIds = new Set<string>()
  const inserted: Snapshot[] = []
  const addedAccounts: string[] = []

  for (const account of active) {
    const entry = entryByAccount.get(account.id)
    const current = mineByAccount.get(account.id)
    const fxRate = fxRateFor(account.currency, rate)

    if (entry) {
      const next: Snapshot = {
        id: current?.id ?? deps.newSnapshotId(),
        review_id: existing.id,
        date,
        account_id: account.id,
        amount: entry.amount,
        currency: account.currency,
        fx_rate: fxRate,
        amount_twd: toTwd(entry.amount, account.currency, rate),
        note: entry.note,
        created_at: current?.created_at ?? deps.createdAt,
      }
      snapshots.push(next)

      if (!current) {
        inserted.push(next)
        addedAccounts.push(account.name)
      } else if (
        current.amount !== next.amount ||
        current.fx_rate !== next.fx_rate ||
        current.currency !== next.currency ||
        current.note !== next.note
      ) {
        changedIds.add(current.id)
      }
      continue
    }

    if (current) {
      // 這次跳過，但當天已經有值 —— 保留它，不要退回上一次的金額
      if (current.fx_rate === fxRate) {
        snapshots.push(current)
      } else {
        // 只有匯率被改動時才重算台幣值，原幣別金額不動
        const repriced: Snapshot = {
          ...current,
          fx_rate: fxRate,
          amount_twd: toTwd(current.amount, account.currency, rate),
        }
        snapshots.push(repriced)
        changedIds.add(current.id)
      }
      continue
    }

    // 當天還沒有這個帳戶，這次也沒填 → 從當天之前沿用
    const prev = previous.get(account.id)
    if (!prev) continue

    const carried: Snapshot = {
      id: deps.newSnapshotId(),
      review_id: existing.id,
      date,
      account_id: account.id,
      amount: prev.amount,
      currency: account.currency,
      fx_rate: fxRate,
      amount_twd: toTwd(prev.amount, account.currency, rate),
      note: CARRY_FORWARD_NOTE,
      created_at: deps.createdAt,
    }
    snapshots.push(carried)
    inserted.push(carried)
    addedAccounts.push(account.name)
  }

  // 已封存帳戶在那天留下的明細照樣保留，否則彙總會少算它、但列還在 Sheet 上
  for (const snapshot of mine) {
    if (!byId.has(snapshot.account_id)) snapshots.push(snapshot)
  }

  const accountsById = new Map(accounts.map((a) => [a.id, a]))
  const totals = sumTotals(
    snapshots.map((s) => ({
      isLiability: accountsById.get(s.account_id)?.is_liability ?? false,
      amountTwd: s.amount_twd,
    })),
  )

  return {
    review: {
      ...existing,
      usd_twd_rate: rate,
      total_assets_twd: totals.assets,
      total_liabilities_twd: totals.liabilities,
      net_worth_twd: totals.netWorth,
      note: input.note || existing.note,
    },
    snapshots,
    changedIds,
    inserted,
    addedAccounts,
  }
}
