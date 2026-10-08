import { describe, expect, it } from 'vitest'
import type { Account, ReviewInput, Snapshot } from './model'
import { buildReview, CARRY_FORWARD_NOTE, ReviewBuildError } from './review'

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
