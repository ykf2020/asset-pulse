import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, Snapshot } from '@shared/model'
import { App } from './App'
import { queryClient } from './app/queryClient'
import { clearDataCache } from './lib/db'
import type { DataPayload } from './lib/api'

/* ------------------------------------------------------------------ */
/* 一組貼近實際使用的資料：兩個銀行、一個期貨戶、一個美元交易所、兩筆信貸     */
/* ------------------------------------------------------------------ */

const USD_RATE = 31.5

function account(id: string, name: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    name,
    type: 'bank',
    currency: 'TWD',
    institution: '',
    is_liability: false,
    sort_order: 0,
    status: 'active',
    note: '',
    created_at: '2026-01-01T00:00:00.000Z',
    ...extra,
  }
}

function snapshot(
  accountId: string,
  amount: number,
  date: string,
  currency: 'TWD' | 'USD' = 'TWD',
): Snapshot {
  const fxRate = currency === 'USD' ? USD_RATE : 1
  return {
    id: `snp_${accountId}_${date}`,
    review_id: `rev_${date}`,
    date,
    account_id: accountId,
    amount,
    currency,
    fx_rate: fxRate,
    amount_twd: amount * fxRate,
    note: '',
    created_at: `${date}T09:00:00.000Z`,
  }
}

const ACCOUNTS: Account[] = [
  account('a_esun', '玉山數位帳戶', { sort_order: 1, institution: '玉山銀行' }),
  account('a_ctbc', '中信薪轉戶', { sort_order: 2, institution: '中國信託' }),
  account('a_fut', '元大期貨', { type: 'futures', sort_order: 3 }),
  account('a_pionex', 'Pionex', { type: 'crypto', currency: 'USD', sort_order: 4 }),
  account('a_loan1', '台新信貸', { type: 'loan', is_liability: true, sort_order: 5 }),
  account('a_loan2', '國泰信貸', { type: 'loan', is_liability: true, sort_order: 6 }),
]

const SNAPSHOTS: Snapshot[] = [
  // 上一次盤點
  snapshot('a_esun', 480_000, '2026-09-28'),
  snapshot('a_ctbc', 110_000, '2026-09-28'),
  snapshot('a_fut', 225_000, '2026-09-28'),
  snapshot('a_pionex', 4_800, '2026-09-28', 'USD'),
  snapshot('a_loan1', 310_000, '2026-09-28'),
  snapshot('a_loan2', 155_000, '2026-09-28'),
  // 最新一次
  snapshot('a_esun', 500_000, '2026-10-05'),
  snapshot('a_ctbc', 120_000, '2026-10-05'),
  snapshot('a_fut', 230_000, '2026-10-05'),
  snapshot('a_pionex', 5_000, '2026-10-05', 'USD'),
  snapshot('a_loan1', 300_000, '2026-10-05'),
  snapshot('a_loan2', 150_000, '2026-10-05'),
]

// 資產 500,000 + 120,000 + 230,000 + (5,000 × 31.5 = 157,500) = 1,007,500
// 負債 300,000 + 150,000 = 450,000  →  淨資產 557,500
const EXPECTED_NET_WORTH = 'NT$ 557,500'

const PAYLOAD: DataPayload = {
  needsBootstrap: false,
  sheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit',
  accounts: ACCOUNTS,
  snapshots: SNAPSHOTS,
  reviews: [
    {
      id: 'rev_2026-09-28',
      date: '2026-09-28',
      usd_twd_rate: USD_RATE,
      total_assets_twd: 966_200,
      total_liabilities_twd: 465_000,
      net_worth_twd: 501_200,
      note: '',
      created_at: '2026-09-28T09:00:00.000Z',
    },
    {
      id: 'rev_2026-10-05',
      date: '2026-10-05',
      usd_twd_rate: USD_RATE,
      total_assets_twd: 1_007_500,
      total_liabilities_twd: 450_000,
      net_worth_twd: 557_500,
      note: '',
      created_at: '2026-10-05T09:00:00.000Z',
    },
  ],
  settings: { stale_days: 10, review_weekday: 0, base_currency: 'TWD' },
  warnings: [],
  fetchedAt: '2026-10-08T00:00:00.000Z',
}

function mockApi(payload: DataPayload = PAYLOAD) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/data')) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/api/auth')) {
        return new Response(JSON.stringify({ configured: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: '未預期的請求' }), { status: 404 })
    }),
  )
}

beforeEach(async () => {
  queryClient.clear()
  await clearDataCache() // 每個案例都從沒有離線快取的狀態開始
})

describe('App', () => {
  it('沒有 token 時顯示 PIN 解鎖畫面，不會碰到資料', async () => {
    mockApi()
    render(<App />)

    expect(await screen.findByRole('heading', { name: '資產脈動' })).toBeInTheDocument()
    expect(screen.getByText('輸入 PIN 解鎖')).toBeInTheDocument()
    expect(screen.queryByText('淨資產')).not.toBeInTheDocument()
  })

  it('解鎖後首頁算出正確的淨資產，負債有被扣掉、美元有換算', async () => {
    localStorage.setItem('ap.token', 'test-token')
    mockApi()
    render(<App />)

    expect(await screen.findByRole('heading', { name: '淨資產' })).toBeInTheDocument()
    // 大數字與「資產與負債」卡片的小計都會印同一個值，所以用 findAll
    expect((await screen.findAllByText(EXPECTED_NET_WORTH)).length).toBeGreaterThan(0)

    // 資產與負債分開呈現
    expect(await screen.findByText('NT$ 1,007,500')).toBeInTheDocument()
    expect(await screen.findByText('NT$ 450,000')).toBeInTheDocument()

    // 每個帳戶都列出來了
    for (const name of ['玉山數位帳戶', '中信薪轉戶', '元大期貨', 'Pionex', '台新信貸']) {
      expect(await screen.findByText(name)).toBeInTheDocument()
    }
  })

  it('一個帳戶都沒有時，引導去建立第一個帳戶', async () => {
    localStorage.setItem('ap.token', 'test-token')
    mockApi({ ...PAYLOAD, accounts: [], snapshots: [], reviews: [] })
    render(<App />)

    expect(await screen.findByText('先建立第一個帳戶')).toBeInTheDocument()
  })

  it('Google Sheet 還沒初始化時，給出建立分頁的按鈕', async () => {
    localStorage.setItem('ap.token', 'test-token')
    mockApi({ ...PAYLOAD, needsBootstrap: true })
    render(<App />)

    expect(await screen.findByText('Google Sheet 還沒初始化')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /幫我建立分頁/ })).toBeInTheDocument()
  })
})
