import { ACCOUNT_TYPES, type AccountType, type Currency } from '@shared/model'

/**
 * 分類色一律綁定「實體」而不是排名 —— 銀行永遠是 1 號色槽，就算它某個月掉到
 * 第三名也不會換色。色槽順序本身是經過 CVD 驗證的，不要重排。
 */
export const TYPE_COLOR_VAR: Record<AccountType, string> = {
  bank: 'var(--s1)',
  futures: 'var(--s2)',
  crypto: 'var(--s3)',
  stock: 'var(--s4)',
  cash: 'var(--s5)',
  property: 'var(--s6)',
  vehicle: 'var(--s7)',
  other: 'var(--s8)',
  // 貸款是負債，不會出現在資產配置圖裡；這裡只為了型別完整
  loan: 'var(--s2)',
}

export const CURRENCY_COLOR_VAR: Record<Currency, string> = {
  TWD: 'var(--s1)',
  USD: 'var(--s2)',
}

/** 淨資產 vs 負債堆疊條的兩個段 */
export const NET_COLOR_VAR = 'var(--s1)'
export const LIABILITY_COLOR_VAR = 'var(--s2)'

/** 趨勢線只有一條序列，用 1 號色槽；單一序列不需要圖例 */
export const TREND_COLOR_VAR = 'var(--s1)'

/** 配置圖的固定排列順序（不依金額大小排，才不會每次重新上色/重排） */
export const TYPE_CHART_ORDER: readonly AccountType[] = ACCOUNT_TYPES.filter(
  (t) => t !== 'loan',
)

/** 圓環最多 6 段，超過的折成「其他」 */
export const MAX_DONUT_SLICES = 6
