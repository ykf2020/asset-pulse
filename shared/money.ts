import type { Account, AccountType, Currency, Snapshot } from './model.js'

/**
 * 金額約定（整個 App 只有這一條規則，請勿在別處另外處理正負號）：
 *
 * - `amount` 永遠是使用者看到的「正數金額」—— 信貸填 120000，不是 -120000。
 * - 是資產還是負債由 `account.is_liability` 決定。
 * - 淨資產 = Σ(資產台幣) − Σ(負債台幣)。
 *
 * 允許填負數（例如期貨戶權益數為負），此時它就是負的貢獻，公式照舊成立。
 */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** 原幣別金額 → 台幣。TWD 帳戶 fxRate 一律視為 1。 */
export function toTwd(amount: number, currency: Currency, usdTwdRate: number): number {
  if (!Number.isFinite(amount)) return 0
  return round2(amount * fxRateFor(currency, usdTwdRate))
}

/** 某幣別在這次盤點採用的匯率 */
export function fxRateFor(currency: Currency, usdTwdRate: number): number {
  if (currency === 'TWD') return 1
  return Number.isFinite(usdTwdRate) && usdTwdRate > 0 ? usdTwdRate : 1
}

/**
 * 一筆 snapshot 的台幣值。
 *
 * 刻意由 `amount × fx_rate` 推導，而不是直接相信 `amount_twd` 欄位 ——
 * 使用者可能直接在 Google Sheet 上改 `amount`（這是我們答應他的事），那時
 * `amount_twd` 就過期了。`amount` 是人填的事實，`fx_rate` 是當次的換算基準，
 * 由這兩個推回去永遠對。只有在 fx_rate 被改壞時才退回存好的值。
 */
export function snapshotTwd(s: {
  amount: number
  fx_rate: number
  amount_twd: number
}): number {
  if (Number.isFinite(s.fx_rate) && s.fx_rate > 0 && Number.isFinite(s.amount)) {
    return round2(s.amount * s.fx_rate)
  }
  return Number.isFinite(s.amount_twd) ? s.amount_twd : 0
}

export interface Totals {
  /** 資產合計（台幣，正數） */
  assets: number
  /** 負債合計（台幣，正數表示欠多少） */
  liabilities: number
  /** 淨資產 = assets − liabilities */
  netWorth: number
}

export const ZERO_TOTALS: Totals = { assets: 0, liabilities: 0, netWorth: 0 }

/** 一組「帳戶 + 台幣金額」的彙總 */
export function sumTotals(
  items: readonly { isLiability: boolean; amountTwd: number }[],
): Totals {
  let assets = 0
  let liabilities = 0
  for (const item of items) {
    if (!Number.isFinite(item.amountTwd)) continue
    if (item.isLiability) liabilities += item.amountTwd
    else assets += item.amountTwd
  }
  assets = round2(assets)
  liabilities = round2(liabilities)
  return { assets, liabilities, netWorth: round2(assets - liabilities) }
}

/** 由一批 snapshot 算總額（需要 accounts 來判斷是不是負債） */
export function totalsFromSnapshots(
  snapshots: readonly Snapshot[],
  accountsById: ReadonlyMap<string, Account>,
): Totals {
  return sumTotals(
    snapshots.map((s) => ({
      isLiability: accountsById.get(s.account_id)?.is_liability ?? false,
      amountTwd: snapshotTwd(s),
    })),
  )
}

/* ------------------------------------------------------------------ */
/* 取最新快照                                                           */
/* ------------------------------------------------------------------ */

/** 比較兩筆 snapshot 誰比較新：先比 date，再比 created_at */
function isNewer(a: Snapshot, b: Snapshot | undefined): boolean {
  if (!b) return true
  if (a.date !== b.date) return a.date > b.date
  return (a.created_at ?? '') >= (b.created_at ?? '')
}

/** 每個帳戶最新的一筆 snapshot */
export function latestSnapshotByAccount(
  snapshots: readonly Snapshot[],
): Map<string, Snapshot> {
  const latest = new Map<string, Snapshot>()
  for (const s of snapshots) {
    if (isNewer(s, latest.get(s.account_id))) latest.set(s.account_id, s)
  }
  return latest
}

/** 每個帳戶「在指定日期之前（不含）」最新的一筆 snapshot，用來算變化量 */
export function previousSnapshotByAccount(
  snapshots: readonly Snapshot[],
  beforeDate: string,
): Map<string, Snapshot> {
  return latestSnapshotByAccount(snapshots.filter((s) => s.date < beforeDate))
}

/* ------------------------------------------------------------------ */
/* 變化量                                                              */
/* ------------------------------------------------------------------ */

export interface Delta {
  absolute: number
  /** 比例變化；前值為 0 時給 null（避免除以 0 變成 Infinity） */
  percent: number | null
}

export function delta(current: number, previous: number | null | undefined): Delta {
  if (previous === null || previous === undefined || !Number.isFinite(previous)) {
    return { absolute: 0, percent: null }
  }
  const absolute = round2(current - previous)
  if (previous === 0) return { absolute, percent: null }
  return { absolute, percent: round2((absolute / Math.abs(previous)) * 100) }
}

/* ------------------------------------------------------------------ */
/* 配置分析                                                            */
/* ------------------------------------------------------------------ */

export interface AllocationSlice<K extends string = string> {
  key: K
  amountTwd: number
  /** 佔總資產比例 0–100 */
  share: number
}

function buildAllocation<K extends string>(
  buckets: Map<K, number>,
): AllocationSlice<K>[] {
  const total = [...buckets.values()].reduce((a, b) => a + b, 0)
  return [...buckets.entries()]
    .map(([key, amountTwd]) => ({
      key,
      amountTwd: round2(amountTwd),
      share: total > 0 ? round2((amountTwd / total) * 100) : 0,
    }))
    .sort((a, b) => b.amountTwd - a.amountTwd)
}

/** 資產配置（只看資產，不含負債） */
export function allocationByType(
  snapshots: readonly Snapshot[],
  accountsById: ReadonlyMap<string, Account>,
): AllocationSlice<AccountType>[] {
  const buckets = new Map<AccountType, number>()
  for (const s of snapshots) {
    const acc = accountsById.get(s.account_id)
    const twd = snapshotTwd(s)
    if (!acc || acc.is_liability || twd <= 0) continue
    buckets.set(acc.type, (buckets.get(acc.type) ?? 0) + twd)
  }
  return buildAllocation(buckets)
}

export function allocationByCurrency(
  snapshots: readonly Snapshot[],
  accountsById: ReadonlyMap<string, Account>,
): AllocationSlice<Currency>[] {
  const buckets = new Map<Currency, number>()
  for (const s of snapshots) {
    const acc = accountsById.get(s.account_id)
    const twd = snapshotTwd(s)
    if (!acc || acc.is_liability || twd <= 0) continue
    buckets.set(s.currency, (buckets.get(s.currency) ?? 0) + twd)
  }
  return buildAllocation(buckets)
}
