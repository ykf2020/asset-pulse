import { describe, expect, it } from 'vitest'
import type { Account, Review, ReviewInput, Snapshot } from './model.js'
import { buildReview, CARRY_FORWARD_NOTE, mergeReview, ReviewBuildError } from './review.js'

const DEPS = {
  reviewId: 'rev_test',
  newSnapshotId: (() => {
    let n = 0
    return () => `snp_${++n}`
  })(),
  createdAt: '2026-10-08T12:00:00.000Z',
}

function account(partial: Partial<Account> & { id: string; name: string }): Account {
  return {
    type: 'bank',
    currency: 'TWD',
    institution: '',
    is_liability: false,
    sort_order: 0,
    status: 'active',
    note: '',
    created_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

const ACCOUNTS: Account[] = [
  account({ id: 'bank', name: '玉山', sort_order: 1 }),
  account({ id: 'fut', name: '元大期貨', type: 'futures', sort_order: 2 }),
  account({ id: 'pionex', name: 'Pionex', type: 'crypto', currency: 'USD', sort_order: 3 }),
  account({ id: 'loan', name: '台新信貸', type: 'loan', is_liability: true, sort_order: 4 }),
  account({ id: 'old', name: '已結清舊戶', status: 'archived', sort_order: 5 }),
]

function previousSnapshot(accountId: string, amount: number, currency: 'TWD' | 'USD' = 'TWD'): Snapshot {
  const fxRate = currency === 'USD' ? 31 : 1
  return {
    id: `prev_${accountId}`,
    review_id: 'rev_prev',
    date: '2026-10-01',
    account_id: accountId,
    amount,
    currency,
    fx_rate: fxRate,
    amount_twd: amount * fxRate,
    note: '',
    created_at: '2026-10-01T09:00:00.000Z',
  }
}

const PREVIOUS: Snapshot[] = [
  previousSnapshot('bank', 400_000),
  previousSnapshot('fut', 200_000),
  previousSnapshot('pionex', 4_000, 'USD'),
  previousSnapshot('loan', 320_000),
]

function input(partial: Partial<ReviewInput> = {}): ReviewInput {
  return {
    date: '2026-10-08',
    usd_twd_rate: 31.5,
    note: '',
    entries: [],
    ...partial,
  }
}

describe('buildReview', () => {
  it('每個 active 帳戶都產生一筆明細，略過的沿用上次金額', () => {
    const built = buildReview(
      input({ entries: [{ account_id: 'bank', amount: 450_000, note: '' }] }),
      ACCOUNTS,
      PREVIOUS,
      DEPS,
    )

    // 四個 active 帳戶都有明細（已封存的不算）
    expect(built.snapshots).toHaveLength(4)
    expect(built.snapshots.map((s) => s.account_id)).not.toContain('old')

    expect(built.carriedForward).toEqual(['元大期貨', 'Pionex', '台新信貸'])
    const futures = built.snapshots.find((s) => s.account_id === 'fut')!
    expect(futures.amount).toBe(200_000)
    expect(futures.note).toBe(CARRY_FORWARD_NOTE)
  })

  it('彙總用的是本次匯率，不是上次的', () => {
    const built = buildReview(input(), ACCOUNTS, PREVIOUS, DEPS)
    const pionex = built.snapshots.find((s) => s.account_id === 'pionex')!

    expect(pionex.fx_rate).toBe(31.5)
    expect(pionex.amount_twd).toBe(4_000 * 31.5)
    // 台幣帳戶的匯率不受影響
    expect(built.snapshots.find((s) => s.account_id === 'bank')!.fx_rate).toBe(1)
  })

  it('負債從淨資產扣除，彙總數字對得起來', () => {
    const built = buildReview(
      input({
        entries: [
          { account_id: 'bank', amount: 500_000, note: '' },
          { account_id: 'fut', amount: 230_000, note: '' },
          { account_id: 'pionex', amount: 5_000, note: '' },
          { account_id: 'loan', amount: 300_000, note: '' },
        ],
      }),
      ACCOUNTS,
      PREVIOUS,
      DEPS,
    )

    const expectedAssets = 500_000 + 230_000 + 5_000 * 31.5
    expect(built.review.total_assets_twd).toBe(expectedAssets)
    expect(built.review.total_liabilities_twd).toBe(300_000)
    expect(built.review.net_worth_twd).toBe(expectedAssets - 300_000)
    expect(built.carriedForward).toEqual([])
  })

  it('從沒填過、這次也沒填的帳戶不會憑空生出 0 元明細', () => {
    const brandNew = [...ACCOUNTS, account({ id: 'new', name: '剛開的戶', sort_order: 6 })]
    const built = buildReview(input(), brandNew, PREVIOUS, DEPS)

    expect(built.snapshots.map((s) => s.account_id)).not.toContain('new')
    expect(built.carriedForward).not.toContain('剛開的戶')
  })

  it('填到已封存或不存在的帳戶會被擋下來', () => {
    expect(() =>
      buildReview(
        input({ entries: [{ account_id: 'old', amount: 1, note: '' }] }),
        ACCOUNTS,
        PREVIOUS,
        DEPS,
      ),
    ).toThrow(ReviewBuildError)
  })

  it('第一次盤點、完全沒填任何金額時明確報錯，而不是寫一筆空紀錄', () => {
    expect(() => buildReview(input(), ACCOUNTS, [], DEPS)).toThrow(ReviewBuildError)
  })

  it('補登過去某一天時，沿用的是那一天之前的金額，不是最新的', () => {
    const laterSnapshots = [...PREVIOUS, previousSnapshot('bank', 999_999)]
    laterSnapshots[laterSnapshots.length - 1]!.date = '2026-10-20'

    const built = buildReview(input({ date: '2026-10-08' }), ACCOUNTS, laterSnapshots, DEPS)
    expect(built.snapshots.find((s) => s.account_id === 'bank')!.amount).toBe(400_000)
  })
})

/* ------------------------------------------------------------------ */
/* 併入同一天已存在的盤點                                                */
/* ------------------------------------------------------------------ */

describe('mergeReview', () => {
  const TODAY = '2026-10-09'

  const todayReview: Review = {
    id: 'rev_today',
    date: TODAY,
    usd_twd_rate: 31.5,
    total_assets_twd: 0,
    total_liabilities_twd: 0,
    net_worth_twd: 0,
    note: '',
    created_at: '2026-10-09T09:00:00.000Z',
  }

  /** 今天已經填好的明細 */
  function todaySnapshot(
    accountId: string,
    amount: number,
    currency: 'TWD' | 'USD' = 'TWD',
  ): Snapshot {
    const fxRate = currency === 'USD' ? 31.5 : 1
    return {
      id: `today_${accountId}`,
      review_id: 'rev_today',
      date: TODAY,
      account_id: accountId,
      amount,
      currency,
      fx_rate: fxRate,
      amount_twd: amount * fxRate,
      note: '',
      created_at: '2026-10-09T09:00:00.000Z',
    }
  }

  const MERGE_DEPS = { newSnapshotId: () => 'snp_new', createdAt: '2026-10-09T18:00:00.000Z' }

  // 上週的值 + 今天已經填好的值
  const SNAPSHOTS = [
    ...PREVIOUS,
    todaySnapshot('bank', 500_000),
    todaySnapshot('fut', 230_000),
    todaySnapshot('pionex', 5_000, 'USD'),
    todaySnapshot('loan', 300_000),
  ]

  /**
   * 使用者實際遇到的情境：今天盤點完才想起漏了一個帳戶，補建之後再跑一次
   * 流程，把已經填過的都跳過、只填新的那個。
   */
  it('補一個新帳戶時，不會動到當天其他帳戶的金額', () => {
    const accounts = [...ACCOUNTS, account({ id: 'epay', name: '街口支付', type: 'epay', sort_order: 7 })]

    const merged = mergeReview(
      input({ date: TODAY, entries: [{ account_id: 'epay', amount: 3_500, note: '' }] }),
      todayReview,
      accounts,
      SNAPSHOTS,
      MERGE_DEPS,
    )

    expect(merged.addedAccounts).toEqual(['街口支付'])
    expect(merged.inserted).toHaveLength(1)
    expect(merged.inserted[0]!.amount).toBe(3_500)
    // 既有的四筆完全沒被改動
    expect(merged.changedIds.size).toBe(0)

    const byAccount = new Map(merged.snapshots.map((s) => [s.account_id, s]))
    expect(byAccount.get('bank')!.amount).toBe(500_000)
    expect(byAccount.get('fut')!.amount).toBe(230_000)
    expect(byAccount.get('pionex')!.amount).toBe(5_000)
  })

  /**
   * 這是 409 擋著時沒被發現、但一旦允許「強制送出」就會踩到的資料損毀：
   * 併入時如果照新開一筆的邏輯去沿用，會抓到「當天之前」也就是上週的金額，
   * 把今天剛填好的數字蓋掉，而且使用者看不出來。
   */
  it('跳過的帳戶保留「當天」的金額，不會退回上一次盤點的值', () => {
    const merged = mergeReview(
      input({ date: TODAY, entries: [] }),
      todayReview,
      ACCOUNTS,
      SNAPSHOTS,
      MERGE_DEPS,
    )

    const byAccount = new Map(merged.snapshots.map((s) => [s.account_id, s]))
    expect(byAccount.get('bank')!.amount).toBe(500_000) // 今天的值，不是上週的 400,000
    expect(byAccount.get('fut')!.amount).toBe(230_000) // 不是 200,000
    expect(byAccount.get('loan')!.amount).toBe(300_000) // 不是 320,000
    expect(merged.changedIds.size).toBe(0)
    expect(merged.inserted).toEqual([])
  })

  it('有填的帳戶會更新，並標記成需要就地改寫', () => {
    const merged = mergeReview(
      input({ date: TODAY, entries: [{ account_id: 'bank', amount: 512_000, note: '' }] }),
      todayReview,
      ACCOUNTS,
      SNAPSHOTS,
      MERGE_DEPS,
    )

    expect(merged.changedIds).toEqual(new Set(['today_bank']))
    expect(merged.inserted).toEqual([])
    const bank = merged.snapshots.find((s) => s.account_id === 'bank')!
    expect(bank.amount).toBe(512_000)
    expect(bank.id).toBe('today_bank') // 沿用原本那一列，不會多出一筆
  })

  it('彙總重算正確（負債照樣扣掉）', () => {
    const merged = mergeReview(
      input({ date: TODAY, entries: [{ account_id: 'bank', amount: 512_000, note: '' }] }),
      todayReview,
      ACCOUNTS,
      SNAPSHOTS,
      MERGE_DEPS,
    )

    const expectedAssets = 512_000 + 230_000 + 5_000 * 31.5
    expect(merged.review.total_assets_twd).toBe(expectedAssets)
    expect(merged.review.total_liabilities_twd).toBe(300_000)
    expect(merged.review.net_worth_twd).toBe(expectedAssets - 300_000)
    expect(merged.review.id).toBe('rev_today') // 還是同一筆，沒有新開
  })

  it('改匯率會重算當天所有美元帳戶，但不動原幣別金額', () => {
    const merged = mergeReview(
      input({ date: TODAY, usd_twd_rate: 32.5, entries: [] }),
      todayReview,
      ACCOUNTS,
      SNAPSHOTS,
      MERGE_DEPS,
    )

    const pionex = merged.snapshots.find((s) => s.account_id === 'pionex')!
    expect(pionex.amount).toBe(5_000)
    expect(pionex.fx_rate).toBe(32.5)
    expect(pionex.amount_twd).toBe(5_000 * 32.5)
    expect(merged.changedIds).toEqual(new Set(['today_pionex']))
  })

  /** 離線佇列重送時不能寫出第二筆，也不能把金額加倍 */
  it('同樣的內容送兩次結果一樣（冪等）', () => {
    const payload = input({
      date: TODAY,
      entries: [{ account_id: 'bank', amount: 512_000, note: '' }],
    })

    const first = mergeReview(payload, todayReview, ACCOUNTS, SNAPSHOTS, MERGE_DEPS)

    // 把第一次的結果寫回去之後再送一次
    const afterFirst = SNAPSHOTS.map((s) => first.snapshots.find((n) => n.id === s.id) ?? s)
    const second = mergeReview(payload, first.review, ACCOUNTS, afterFirst, MERGE_DEPS)

    expect(second.inserted).toEqual([])
    expect(second.changedIds.size).toBe(0)
    expect(second.review.net_worth_twd).toBe(
      first.review.net_worth_twd,
    )
  })

  it('當天沒有、這次也沒填的帳戶，從當天之前沿用', () => {
    const withoutToday = SNAPSHOTS.filter((s) => s.account_id !== 'fut' || s.date !== TODAY)

    const merged = mergeReview(
      input({ date: TODAY, entries: [] }),
      todayReview,
      ACCOUNTS,
      withoutToday,
      MERGE_DEPS,
    )

    const futures = merged.snapshots.find((s) => s.account_id === 'fut')!
    expect(futures.amount).toBe(200_000) // 上週的值
    expect(futures.note).toBe(CARRY_FORWARD_NOTE)
    expect(merged.inserted).toHaveLength(1)
  })

  it('已封存帳戶當天留下的明細不會被丟掉', () => {
    const archivedSnapshot = todaySnapshot('old', 50_000)
    const merged = mergeReview(
      input({ date: TODAY, entries: [] }),
      todayReview,
      ACCOUNTS,
      [...SNAPSHOTS, archivedSnapshot],
      MERGE_DEPS,
    )

    expect(merged.snapshots.map((s) => s.id)).toContain('today_old')
  })
})
