import type { Account, Review, ReviewInput, Snapshot } from './model'
import { fxRateFor, previousSnapshotByAccount, sumTotals, toTwd } from './money'

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
