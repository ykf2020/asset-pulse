import { describe, expect, it } from 'vitest'
import {
  allocationByType,
  delta,
  fxRateFor,
  latestSnapshotByAccount,
  previousSnapshotByAccount,
  snapshotTwd,
  sumTotals,
  toTwd,
  totalsFromSnapshots,
} from './money'
import type { Account, Snapshot } from './model'

function account(partial: Partial<Account> & { id: string }): Account {
  return {
    name: partial.id,
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

function snapshot(partial: Partial<Snapshot> & { id: string; account_id: string }): Snapshot {
  const amount = partial.amount ?? 0
  const fxRate = partial.fx_rate ?? 1
  return {
    review_id: 'rev_1',
    date: '2026-10-01',
    amount,
    currency: 'TWD',
    fx_rate: fxRate,
    amount_twd: amount * fxRate,
    note: '',
    created_at: '2026-10-01T00:00:00.000Z',
    ...partial,
  }
}

describe('換匯', () => {
  it('台幣帳戶的匯率永遠是 1，不受傳入匯率影響', () => {
    expect(fxRateFor('TWD', 31.9)).toBe(1)
    expect(toTwd(1000, 'TWD', 31.9)).toBe(1000)
  })

  it('美元帳戶用傳入匯率換算，結果留兩位小數', () => {
    expect(toTwd(1234.56, 'USD', 31.869)).toBe(39344.19)
  })

  it('匯率壞掉（0 或負數）時退回 1，不會把資產算成 0', () => {
    expect(fxRateFor('USD', 0)).toBe(1)
    expect(fxRateFor('USD', Number.NaN)).toBe(1)
    expect(toTwd(500, 'USD', 0)).toBe(500)
  })
})

describe('snapshotTwd：以 amount × fx_rate 為準', () => {
  it('使用者在 Sheet 手動改了 amount，台幣值要跟著對，而不是沿用舊的 amount_twd', () => {
    const edited = snapshot({
      id: 's1',
      account_id: 'a1',
      amount: 2000, // 手動從 1000 改成 2000
      fx_rate: 31.5,
      amount_twd: 31500, // 這一格還是舊的
    })
    expect(snapshotTwd(edited)).toBe(63000)
  })

  it('fx_rate 被改壞時才退回存好的 amount_twd', () => {
    const broken = snapshot({ id: 's1', account_id: 'a1', amount: 100, fx_rate: 0, amount_twd: 3190 })
    expect(snapshotTwd(broken)).toBe(3190)
  })
})

describe('淨資產彙總', () => {
  const accounts = new Map([
    ['bank', account({ id: 'bank' })],
    ['futures', account({ id: 'futures', type: 'futures' })],
    ['crypto', account({ id: 'crypto', type: 'crypto', currency: 'USD' })],
    ['loan', account({ id: 'loan', type: 'loan', is_liability: true })],
  ])

  const snapshots = [
    snapshot({ id: 's1', account_id: 'bank', amount: 500_000 }),
    snapshot({ id: 's2', account_id: 'futures', amount: 120_000 }),
    snapshot({ id: 's3', account_id: 'crypto', amount: 10_000, currency: 'USD', fx_rate: 31.869 }),
    snapshot({ id: 's4', account_id: 'loan', amount: 300_000 }),
  ]

  it('負債以正數填寫，彙總時才被扣掉', () => {
    const totals = totalsFromSnapshots(snapshots, accounts)
    expect(totals.assets).toBe(500_000 + 120_000 + 318_690)
    expect(totals.liabilities).toBe(300_000)
    expect(totals.netWorth).toBe(938_690 - 300_000)
  })

  it('負債大於資產時淨資產為負', () => {
    const totals = sumTotals([
      { isLiability: false, amountTwd: 100_000 },
      { isLiability: true, amountTwd: 250_000 },
    ])
    expect(totals.netWorth).toBe(-150_000)
  })

  it('期貨戶權益數為負時，是負的資產貢獻而不是負債', () => {
    const totals = sumTotals([
      { isLiability: false, amountTwd: 500_000 },
      { isLiability: false, amountTwd: -30_000 },
    ])
    expect(totals.assets).toBe(470_000)
    expect(totals.liabilities).toBe(0)
    expect(totals.netWorth).toBe(470_000)
  })

  it('資產配置只看資產，不含負債', () => {
    const slices = allocationByType(snapshots, accounts)
    expect(slices.map((s) => s.key)).not.toContain('loan')
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(100, 0)
  })
})

describe('取最新快照', () => {
  const snapshots = [
    snapshot({ id: 'a', account_id: 'x', date: '2026-09-01', amount: 100 }),
    snapshot({ id: 'b', account_id: 'x', date: '2026-10-01', amount: 200 }),
    snapshot({
      id: 'c',
      account_id: 'x',
      date: '2026-10-01',
      amount: 250,
      created_at: '2026-10-01T10:00:00.000Z',
    }),
  ]

  it('同一天有多筆時取 created_at 較新的', () => {
    expect(latestSnapshotByAccount(snapshots).get('x')?.amount).toBe(250)
  })

  it('previousSnapshotByAccount 不含指定日期當天', () => {
    expect(previousSnapshotByAccount(snapshots, '2026-10-01').get('x')?.amount).toBe(100)
  })
})

describe('變化量', () => {
  it('沒有前值時不假裝有變化', () => {
    expect(delta(1000, null)).toEqual({ absolute: 0, percent: null })
  })

  it('前值為 0 時給得出絕對差，但不給百分比（避免除以 0）', () => {
    expect(delta(1000, 0)).toEqual({ absolute: 1000, percent: null })
  })

  it('前值為負時，百分比用絕對值當分母', () => {
    expect(delta(-50, -100)).toEqual({ absolute: 50, percent: 50 })
  })
})
