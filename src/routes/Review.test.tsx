import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Account, Snapshot } from '@shared/model'
import { queryClient, dataQueryKey } from '@/app/queryClient'
import type { DataPayload } from '@/lib/api'
import { Review } from './Review'

const USD_RATE = 31.5
const TODAY = '2026-10-09'
const LAST_WEEK = '2026-10-02'

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
  reviewId: string,
  currency: 'TWD' | 'USD' = 'TWD',
): Snapshot {
  const fxRate = currency === 'USD' ? USD_RATE : 1
  return {
    id: `snp_${accountId}_${date}`,
    review_id: reviewId,
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
  account('a_bank', '玉山數位帳戶', { sort_order: 1 }),
  account('a_epay', '街口支付', { type: 'epay', sort_order: 2 }),
  account('a_fut', '元大期貨', { type: 'futures', sort_order: 3 }),
  account('a_us', '口袋美股', { type: 'stock', currency: 'USD', sort_order: 4 }),
  account('a_loan', '台新信貸', { type: 'loan', is_liability: true, sort_order: 5 }),
]

/** 10/09 已經盤點過，但「口袋美股」是盤點完才建的，所以不在那一筆裡 */
const SNAPSHOTS: Snapshot[] = [
  snapshot('a_bank', 500_000, TODAY, 'rev_today'),
  snapshot('a_epay', 3_000, TODAY, 'rev_today'),
  snapshot('a_fut', 230_000, TODAY, 'rev_today'),
  snapshot('a_loan', 300_000, TODAY, 'rev_today'),
]

function payload(overrides: Partial<DataPayload> = {}): DataPayload {
  return {
    needsBootstrap: false,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit',
    accounts: ACCOUNTS,
    snapshots: SNAPSHOTS,
    reviews: [
      {
        id: 'rev_today',
        date: TODAY,
        usd_twd_rate: USD_RATE,
        total_assets_twd: 733_000,
        total_liabilities_twd: 300_000,
        net_worth_twd: 433_000,
        note: '',
        created_at: `${TODAY}T09:00:00.000Z`,
      },
    ],
    settings: { stale_days: 10, review_weekday: 0, base_currency: 'TWD' },
    warnings: [],
    fetchedAt: `${TODAY}T10:00:00.000Z`,
    ...overrides,
  }
}

/**
 * 今天還沒盤點過的情況：上週的紀錄齊全（除了之後才建的「口袋美股」），
 * 所以不會出現「待補」過濾器，全部帳戶直接列出來。
 */
function freshPayload(): DataPayload {
  return payload({
    snapshots: SNAPSHOTS.map((s) => ({
      ...s,
      id: s.id.replace(TODAY, LAST_WEEK),
      date: LAST_WEEK,
      review_id: 'rev_last_week',
      created_at: `${LAST_WEEK}T09:00:00.000Z`,
    })),
    reviews: [
      {
        id: 'rev_last_week',
        date: LAST_WEEK,
        usd_twd_rate: USD_RATE,
        total_assets_twd: 733_000,
        total_liabilities_twd: 300_000,
        net_worth_twd: 433_000,
        note: '',
        created_at: `${LAST_WEEK}T09:00:00.000Z`,
      },
    ],
  })
}

function renderReview(data: DataPayload = payload()) {
  queryClient.setQueryData(dataQueryKey, data)
  queryClient.setQueryData(['fx'], { rate: USD_RATE, source: 'live', asOf: TODAY })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/review']}>
        <Review />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** 找某個帳戶那一列的金額輸入框 */
function amountInput(accountName: string) {
  return screen.getByLabelText(accountName)
}

beforeEach(() => {
  queryClient.clear()
})

describe('盤點頁（單頁列出全部）', () => {
  it('所有帳戶都在同一頁上，不用一頁一頁翻', async () => {
    renderReview(freshPayload())

    for (const name of ['玉山數位帳戶', '街口支付', '元大期貨', '口袋美股', '台新信貸']) {
      expect(await screen.findByLabelText(name)).toBeInTheDocument()
    }
  })

  it('依類型分組，負債擺最後', async () => {
    renderReview(freshPayload())

    const headings = (await screen.findAllByRole('heading', { level: 2 })).map(
      (h) => h.textContent,
    )
    expect(headings).toEqual(['銀行帳戶', '電子支付', '證券', '期貨戶', '負債'])
  })

  it('留空的欄位用既有金額當 placeholder，讓人看得出不填會算成多少', async () => {
    renderReview(freshPayload())

    expect(await amountInput('玉山數位帳戶')).toHaveAttribute('placeholder', '500,000')
    // 從來沒填過的帳戶沒有可沿用的值
    expect(amountInput('口袋美股')).toHaveAttribute('placeholder', '0')
    expect(screen.getByText('還沒填過')).toBeInTheDocument()
  })

  /** 單頁最大的好處：邊填邊看到淨資產怎麼變 */
  it('輸入時底部的淨資產即時更新', async () => {
    const user = userEvent.setup()
    renderReview(freshPayload())

    // 500,000 + 3,000 + 230,000 − 300,000 = 433,000
    expect(await screen.findByText('NT$ 433,000')).toBeInTheDocument()

    await user.type(await amountInput('玉山數位帳戶'), '520000')

    expect(await screen.findByText('NT$ 453,000')).toBeInTheDocument()
  })

  it('美元帳戶用當下的匯率換算進淨資產', async () => {
    const user = userEvent.setup()
    renderReview()

    await user.type(await amountInput('口袋美股'), '1000')

    // 433,000 + 1,000 × 31.5 = 464,500
    expect(await screen.findByText('NT$ 464,500')).toBeInTheDocument()
  })

  it('負債增加會讓淨資產下降', async () => {
    const user = userEvent.setup()
    renderReview(freshPayload())

    await user.type(await amountInput('台新信貸'), '350000')

    expect(await screen.findByText('NT$ 383,000')).toBeInTheDocument()
  })

  /**
   * 使用者實際遇到的情境：盤點完才補建帳戶。預設只顯示那一天還沒納入的帳戶，
   * 不用在 31 個裡面自己找。
   */
  it('當天已盤點過時，預設只顯示還沒納入的帳戶', async () => {
    renderReview()

    expect(await screen.findByText('這一天已經盤點過了')).toBeInTheDocument()
    expect(await amountInput('口袋美股')).toBeInTheDocument()
    expect(screen.queryByLabelText('玉山數位帳戶')).not.toBeInTheDocument()

    const filter = screen.getByRole('radiogroup', { name: '要顯示哪些帳戶' })
    expect(within(filter).getByRole('radio', { name: '待補 (1)' })).toBeChecked()
  })

  it('切到「全部」就看得到所有帳戶', async () => {
    const user = userEvent.setup()
    renderReview()

    await user.click(await screen.findByRole('radio', { name: '全部 (5)' }))

    expect(await screen.findByLabelText('玉山數位帳戶')).toBeInTheDocument()
  })

  it('全新的日期不顯示過濾器，直接列出全部', async () => {
    renderReview(freshPayload())

    expect(screen.queryByRole('radiogroup', { name: '要顯示哪些帳戶' })).not.toBeInTheDocument()
    expect(await screen.findByLabelText('玉山數位帳戶')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /送出盤點/ })).toBeInTheDocument()
  })

  it('併入模式的送出按鈕講清楚它會做什麼', async () => {
    renderReview()
    expect(await screen.findByRole('button', { name: /併入當天的盤點/ })).toBeInTheDocument()
  })

  it('顯示已填進度', async () => {
    const user = userEvent.setup()
    renderReview()

    expect(await screen.findByText('已填 0 / 5 個帳戶')).toBeInTheDocument()
    await user.type(await amountInput('口袋美股'), '1000')
    expect(await screen.findByText('已填 1 / 5 個帳戶')).toBeInTheDocument()
  })
})
