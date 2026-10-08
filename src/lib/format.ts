import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { zhTW } from 'date-fns/locale'
import type { Currency } from '@shared/model'

const CURRENCY_PREFIX: Record<Currency, string> = {
  TWD: 'NT$',
  USD: 'US$',
}

const integerFmt = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 })
const decimalFmt = new Intl.NumberFormat('zh-TW', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 台幣顯示到整數就好；美元留兩位小數（金額通常比較小） */
export function formatMoney(
  amount: number,
  currency: Currency = 'TWD',
  options: { showPrefix?: boolean; decimals?: boolean } = {},
): string {
  const { showPrefix = true, decimals = currency === 'USD' } = options
  const safe = Number.isFinite(amount) ? amount : 0
  const body = decimals ? decimalFmt.format(safe) : integerFmt.format(Math.round(safe))
  return showPrefix ? `${CURRENCY_PREFIX[currency]} ${body}` : body
}

export function formatTwd(amount: number, options?: { showPrefix?: boolean }): string {
  return formatMoney(amount, 'TWD', options)
}

/** 永遠帶正負號，用於變化量 */
export function formatSignedTwd(amount: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : ''
  return `${sign}NT$ ${integerFmt.format(Math.abs(Math.round(amount)))}`
}

export function formatPercent(percent: number | null, options: { signed?: boolean } = {}): string {
  if (percent === null || !Number.isFinite(percent)) return '—'
  const sign = options.signed ? (percent > 0 ? '+' : percent < 0 ? '−' : '') : ''
  return `${sign}${Math.abs(percent).toFixed(1)}%`
}

/** 圖表座標軸用的精簡金額：12.3 萬 / 1,234 萬 / 1.23 億 */
export function formatCompactTwd(amount: number): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '−' : ''
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(abs >= 1e9 ? 0 : 2)} 億`
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(abs >= 1e6 ? 0 : 1)} 萬`
  return `${sign}${integerFmt.format(Math.round(abs))}`
}

/* ------------------------------------------------------------------ */
/* 日期                                                                */
/* ------------------------------------------------------------------ */

export function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function formatDate(iso: string, pattern = 'M 月 d 日'): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), pattern, { locale: zhTW })
  } catch {
    return iso
  }
}

export function formatDateFull(iso: string): string {
  return formatDate(iso, 'yyyy 年 M 月 d 日（EEEEE）')
}

export function formatShortDate(iso: string): string {
  return formatDate(iso, 'M/d')
}

export function daysSince(iso: string): number | null {
  if (!iso) return null
  try {
    return differenceInCalendarDays(new Date(), parseISO(iso))
  } catch {
    return null
  }
}

/** 「今天 / 昨天 / 3 天前 / 10 月 1 日」 */
export function formatSince(iso: string): string {
  const days = daysSince(iso)
  if (days === null) return '—'
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  return formatDate(iso)
}

/* ------------------------------------------------------------------ */
/* 輸入解析                                                            */
/* ------------------------------------------------------------------ */

/** 使用者可能貼上「1,234,567」或「NT$ 1234」或全形數字 */
export function parseAmountInput(raw: string): number | null {
  const normalized = raw
    .normalize('NFKC')
    .replace(/[,\s]/g, '')
    .replace(/[^0-9.\-]/g, '')
  if (normalized === '' || normalized === '-' || normalized === '.') return null
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

/** 輸入框即時加千分位，保留使用者正在打的小數點 */
export function formatAmountWhileTyping(raw: string): string {
  const normalized = raw.normalize('NFKC').replace(/[^0-9.\-]/g, '')
  if (normalized === '') return ''

  const negative = normalized.startsWith('-')
  const [intPartRaw = '', ...rest] = normalized.replace(/-/g, '').split('.')
  const intPart = intPartRaw === '' ? '' : integerFmt.format(Number(intPartRaw))
  const decimals = rest.length > 0 ? `.${rest.join('').slice(0, 2)}` : ''

  return `${negative ? '-' : ''}${intPart}${decimals}`
}
