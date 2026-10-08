import {
  ACCOUNT_TYPE_LABEL,
  CURRENCY_LABEL,
  type Account,
  type AccountType,
  type AppSettings,
  type Currency,
  type Review,
  type Snapshot,
} from '@shared/model'
import {
  delta,
  snapshotTwd,
  sumTotals,
  ZERO_TOTALS,
  type Delta,
  type Totals,
} from '@shared/money'
import type { DataPayload } from './api'
import { daysSince } from './format'
import { MAX_DONUT_SLICES, TYPE_CHART_ORDER, TYPE_COLOR_VAR, CURRENCY_COLOR_VAR } from './palette'

export interface AccountView {
  account: Account
  latest: Snapshot | null
  previous: Snapshot | null
  /** 最新金額（原幣別） */
  amount: number
  /** 最新金額（台幣） */
  amountTwd: number
  /** 與上一次相比（台幣） */
  deltaTwd: Delta
  lastUpdated: string | null
  daysSinceUpdate: number | null
  isStale: boolean
}

export interface TrendPoint {
  date: string
  netWorth: number
  assets: number
  liabilities: number
}

export interface Slice {
  key: string
  label: string
  color: string
  amountTwd: number
  share: number
}

export interface Overview {
  hasAccounts: boolean
  hasReviews: boolean
  latestDate: string | null
  previousDate: string | null
  totals: Totals
  previousTotals: Totals | null
  netWorthDelta: Delta
  assetsDelta: Delta
  liabilitiesDelta: Delta
  trend: TrendPoint[]
  byType: Slice[]
  byCurrency: Slice[]
  accounts: AccountView[]
  staleAccounts: AccountView[]
  /** 已封存、但還有歷史的帳戶（列表最下面折起來） */
  archived: AccountView[]
}

/* ------------------------------------------------------------------ */

function sortedDates(snapshots: readonly Snapshot[]): string[] {
  return [...new Set(snapshots.map((s) => s.date).filter(Boolean))].sort()
}

/**
 * 逐日推進，維護「每個帳戶到該日為止最新的一筆」，算出每個盤點日的總額。
 *
 * 不直接讀 `Reviews` 的彙總欄位，而是從 `Snapshots` 重算 —— 使用者可能直接在
 * Google Sheet 上改明細，重算才會跟著對。`Reviews` 的欄位是給人看 Sheet 時方便，
 * 設定頁有「重新計算彙總」可以把它們補回一致。
 */
export function buildTrend(
  snapshots: readonly Snapshot[],
  accountsById: ReadonlyMap<string, Account>,
): TrendPoint[] {
  const dates = sortedDates(snapshots)
  if (dates.length === 0) return []

  const byDate = new Map<string, Snapshot[]>()
  for (const s of snapshots) {
    const list = byDate.get(s.date)
    if (list) list.push(s)
    else byDate.set(s.date, [s])
  }

  const running = new Map<string, Snapshot>()
  const points: TrendPoint[] = []

  for (const date of dates) {
    for (const s of byDate.get(date) ?? []) {
      const existing = running.get(s.account_id)
      // 同一天同一帳戶有多筆時，取 created_at 較新的
      if (!existing || (s.created_at ?? '') >= (existing.created_at ?? '')) {
        running.set(s.account_id, s)
      }
    }

    const totals = sumTotals(
      [...running.values()].map((s) => ({
        isLiability: accountsById.get(s.account_id)?.is_liability ?? false,
        amountTwd: snapshotTwd(s),
      })),
    )
    points.push({
      date,
      netWorth: totals.netWorth,
      assets: totals.assets,
      liabilities: totals.liabilities,
    })
  }

  return points
}

/** 某一天（含當天）為止，每個帳戶最新的 snapshot */
export function snapshotsAsOf(
  snapshots: readonly Snapshot[],
  date: string,
): Map<string, Snapshot> {
  const result = new Map<string, Snapshot>()
  for (const s of snapshots) {
    if (s.date > date) continue
    const existing = result.get(s.account_id)
    if (
      !existing ||
      s.date > existing.date ||
      (s.date === existing.date && (s.created_at ?? '') >= (existing.created_at ?? ''))
    ) {
      result.set(s.account_id, s)
    }
  }
  return result
}

function buildSlices<K extends string>(
  buckets: Map<K, number>,
  order: readonly K[],
  label: (key: K) => string,
  color: (key: K) => string,
): Slice[] {
  const ordered = order
    .filter((k) => (buckets.get(k) ?? 0) > 0)
    .map((k) => ({ key: k, amountTwd: buckets.get(k)! }))

  // 超過上限就把尾巴折成「其他」，不再生成新顏色
  let slices = ordered
  let otherAmount = 0
  if (ordered.length > MAX_DONUT_SLICES) {
    const bySize = [...ordered].sort((a, b) => b.amountTwd - a.amountTwd)
    const keep = new Set(bySize.slice(0, MAX_DONUT_SLICES - 1).map((s) => s.key))
    otherAmount = bySize
      .slice(MAX_DONUT_SLICES - 1)
      .reduce((sum, s) => sum + s.amountTwd, 0)
    slices = ordered.filter((s) => keep.has(s.key))
  }

  const total = slices.reduce((sum, s) => sum + s.amountTwd, 0) + otherAmount
  const toShare = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0)

  const result: Slice[] = slices.map((s) => ({
    key: s.key,
    label: label(s.key),
    color: color(s.key),
    amountTwd: s.amountTwd,
    share: toShare(s.amountTwd),
  }))

  if (otherAmount > 0) {
    result.push({
      key: '__other__',
      label: '其他',
      color: 'var(--s8)',
      amountTwd: otherAmount,
      share: toShare(otherAmount),
    })
  }

  return result
}

/* ------------------------------------------------------------------ */

export function buildOverview(data: DataPayload, settings: AppSettings): Overview {
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]))
  const trend = buildTrend(data.snapshots, accountsById)

  const latestPoint = trend.at(-1) ?? null
  const previousPoint = trend.length >= 2 ? trend[trend.length - 2]! : null

  const totals: Totals = latestPoint
    ? {
        assets: latestPoint.assets,
        liabilities: latestPoint.liabilities,
        netWorth: latestPoint.netWorth,
      }
    : ZERO_TOTALS

  const previousTotals: Totals | null = previousPoint
    ? {
        assets: previousPoint.assets,
        liabilities: previousPoint.liabilities,
        netWorth: previousPoint.netWorth,
      }
    : null

  const latestDate = latestPoint?.date ?? null
  const latestByAccount = latestDate
    ? snapshotsAsOf(data.snapshots, latestDate)
    : new Map<string, Snapshot>()
  const previousByAccount = previousPoint
    ? snapshotsAsOf(data.snapshots, previousPoint.date)
    : new Map<string, Snapshot>()

  const views: AccountView[] = data.accounts.map((account) => {
    const latest = latestByAccount.get(account.id) ?? null
    const previous = previousByAccount.get(account.id) ?? null
    const amountTwd = latest ? snapshotTwd(latest) : 0
    const days = latest ? daysSince(latest.date) : null

    return {
      account,
      latest,
      previous,
      amount: latest?.amount ?? 0,
      amountTwd,
      deltaTwd: delta(amountTwd, previous ? snapshotTwd(previous) : null),
      lastUpdated: latest?.date ?? null,
      daysSinceUpdate: days,
      isStale:
        account.status === 'active' && (latest === null || (days ?? 0) > settings.stale_days),
    }
  })

  const active = views.filter((v) => v.account.status === 'active')
  const archived = views.filter((v) => v.account.status === 'archived' && v.latest)

  // 配置圖只看資產，且只看最新一期
  const typeBuckets = new Map<AccountType, number>()
  const currencyBuckets = new Map<Currency, number>()
  for (const view of views) {
    if (view.account.is_liability || view.amountTwd <= 0 || !view.latest) continue
    if (view.account.status !== 'active') continue
    typeBuckets.set(view.account.type, (typeBuckets.get(view.account.type) ?? 0) + view.amountTwd)
    currencyBuckets.set(
      view.account.currency,
      (currencyBuckets.get(view.account.currency) ?? 0) + view.amountTwd,
    )
  }

  return {
    hasAccounts: active.length > 0,
    hasReviews: trend.length > 0,
    latestDate,
    previousDate: previousPoint?.date ?? null,
    totals,
    previousTotals,
    netWorthDelta: delta(totals.netWorth, previousTotals?.netWorth ?? null),
    assetsDelta: delta(totals.assets, previousTotals?.assets ?? null),
    liabilitiesDelta: delta(totals.liabilities, previousTotals?.liabilities ?? null),
    trend,
    byType: buildSlices(
      typeBuckets,
      TYPE_CHART_ORDER,
      (k) => ACCOUNT_TYPE_LABEL[k],
      (k) => TYPE_COLOR_VAR[k],
    ),
    byCurrency: buildSlices(
      currencyBuckets,
      ['TWD', 'USD'] as const,
      (k) => CURRENCY_LABEL[k],
      (k) => CURRENCY_COLOR_VAR[k],
    ),
    accounts: active,
    staleAccounts: active.filter((v) => v.isStale),
    archived,
  }
}

/* ------------------------------------------------------------------ */
/* 單次盤點的明細檢視                                                   */
/* ------------------------------------------------------------------ */

export interface ReviewDetailRow {
  account: Account | null
  snapshot: Snapshot
  amountTwd: number
  deltaTwd: Delta
}

export function buildReviewDetail(
  review: Review,
  data: DataPayload,
): { rows: ReviewDetailRow[]; totals: Totals } {
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]))
  const mine = data.snapshots.filter((s) => s.review_id === review.id)
  const beforeThis = data.snapshots.filter((s) => s.date < review.date)
  const previous = snapshotsAsOf(beforeThis, review.date)

  const rows: ReviewDetailRow[] = mine
    .map((snapshot) => {
      const account = accountsById.get(snapshot.account_id) ?? null
      const amountTwd = snapshotTwd(snapshot)
      const prev = previous.get(snapshot.account_id)
      return {
        account,
        snapshot,
        amountTwd,
        deltaTwd: delta(amountTwd, prev ? snapshotTwd(prev) : null),
      }
    })
    .sort((a, b) => (a.account?.sort_order ?? 0) - (b.account?.sort_order ?? 0))

  const totals = sumTotals(
    rows.map((r) => ({
      isLiability: r.account?.is_liability ?? false,
      amountTwd: r.amountTwd,
    })),
  )

  return { rows, totals }
}
