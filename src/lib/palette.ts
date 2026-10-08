import { ACCOUNT_TYPES, type AccountType, type Currency } from '@shared/model'

/**
 * 分類色一律綁定「實體」而不是排名 —— 銀行永遠是 1 號色槽，就算它某個月掉到
 * 第三名也不會換色。色槽順序本身是經過 CVD 驗證的，不要重排。
 *
 * 八個色槽剛好給八種「會出現在資產配置圓環裡」的類型。另外兩種不佔色槽：
 *
 *  - `other`：它既是使用者可選的類型，也是圓環超過 6 段時的收納桶。兩者都是
 *    「未分類」的意思，用中性灰最誠實 —— 剩餘項不該跟真正的分類搶顏色。
 *  - `loan`：負債永遠不會進資產配置圓環，用的是負債專屬的角色色，跟首頁
 *    「資產與負債」那張圖的負債條同一個顏色，看起來才連貫。
 */
export const TYPE_COLOR_VAR: Record<AccountType, string> = {
  bank: 'var(--s1)',
  epay: 'var(--s2)',
  cash: 'var(--s3)',
  stock: 'var(--s4)',
  futures: 'var(--s5)',
  crypto: 'var(--s6)',
  property: 'var(--s7)',
  vehicle: 'var(--s8)',
  loan: 'var(--liability)',
  other: 'var(--slice-other)',
}

/** 圓環收納桶「其他」的顏色，與 other 類型一致 */
export const OTHER_SLICE_COLOR_VAR = 'var(--slice-other)'

export const CURRENCY_COLOR_VAR: Record<Currency, string> = {
  TWD: 'var(--s1)',
  USD: 'var(--s2)',
}

/** 首頁「資產與負債」兩條同尺規的細條 */
export const ASSET_COLOR_VAR = 'var(--s1)'
export const LIABILITY_COLOR_VAR = 'var(--liability)'

/** 趨勢線只有一條序列，用 1 號色槽；單一序列不需要圖例 */
export const TREND_COLOR_VAR = 'var(--s1)'

/**
 * 配置圖的固定排列順序：不依金額大小排，所以同一個類型月月都在同一個位置、
 * 同一個顏色，兩期之間可以直接對照。順序沿用 ACCOUNT_TYPES（流動性由高到低），
 * 並把永遠不會出現在圓環裡的負債排除掉。
 */
export const TYPE_CHART_ORDER: readonly AccountType[] = ACCOUNT_TYPES.filter(
  (t) => t !== 'loan',
)

/** 圓環最多 6 段，超過的折成「其他」 */
export const MAX_DONUT_SLICES = 6
