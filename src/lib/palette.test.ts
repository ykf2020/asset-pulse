import { describe, expect, it } from 'vitest'
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, type AccountType } from '@shared/model'
import {
  MAX_DONUT_SLICES,
  OTHER_SLICE_COLOR_VAR,
  TYPE_CHART_ORDER,
  TYPE_COLOR_VAR,
} from './palette'

/** 會出現在資產配置圓環、需要一個專屬色相的類型 */
const HUED_TYPES = TYPE_CHART_ORDER.filter((t) => t !== 'other')

describe('帳戶類型與色票的對應', () => {
  it('每個類型都有中文標籤', () => {
    for (const type of ACCOUNT_TYPES) {
      expect(ACCOUNT_TYPE_LABEL[type], type).toBeTruthy()
    }
  })

  it('每個類型都有顏色', () => {
    for (const type of ACCOUNT_TYPES) {
      expect(TYPE_COLOR_VAR[type], type).toMatch(/^var\(--[\w-]+\)$/)
    }
  })

  /**
   * 色票只有八個分類色槽，規則是「不得循環重用、不得生成新色相」。
   * 需要色相的資產類型必須剛好用完八個、且兩兩不同 —— 哪天再加新類型，
   * 這個測試會先擋下來，逼人正面處理顏色要從哪裡來。
   */
  it('需要色相的資產類型剛好用滿八個色槽，沒有重複', () => {
    const colors = HUED_TYPES.map((t) => TYPE_COLOR_VAR[t])

    expect(HUED_TYPES).toHaveLength(8)
    expect(new Set(colors).size).toBe(8)
    expect(colors.every((c) => /^var\(--s[1-8]\)$/.test(c))).toBe(true)
  })

  /**
   * 圓環各段的相鄰關係必須照色槽順序 s1→s2→…→s8，因為 CVD 分離度是依
   * 這個順序驗證過的。重排 ACCOUNT_TYPES 而沒有同步調整顏色就會踩到。
   */
  it('圓環的排列順序與色槽順序一致', () => {
    expect(HUED_TYPES.map((t) => TYPE_COLOR_VAR[t])).toEqual([
      'var(--s1)',
      'var(--s2)',
      'var(--s3)',
      'var(--s4)',
      'var(--s5)',
      'var(--s6)',
      'var(--s7)',
      'var(--s8)',
    ])
  })

  it('「其他」用中性灰，不佔分類色槽', () => {
    expect(TYPE_COLOR_VAR.other).toBe(OTHER_SLICE_COLOR_VAR)
    expect(OTHER_SLICE_COLOR_VAR).not.toMatch(/--s[1-8]/)
  })

  it('負債用專屬角色色，不佔分類色槽', () => {
    expect(TYPE_COLOR_VAR.loan).toBe('var(--liability)')
  })

  it('配置圓環不含負債，其餘類型都在', () => {
    expect(TYPE_CHART_ORDER).not.toContain('loan')
    const missing = ACCOUNT_TYPES.filter(
      (t) => t !== 'loan' && !TYPE_CHART_ORDER.includes(t),
    )
    expect(missing).toEqual([])
  })

  it('收納桶上限小於色槽數，所以永遠不會同時畫出超過八個色相', () => {
    expect(MAX_DONUT_SLICES).toBeLessThanOrEqual(8)
  })
})

describe('電子支付', () => {
  it('是獨立的類型，不跟現金或銀行混在一起', () => {
    const epay: AccountType = 'epay'
    expect(ACCOUNT_TYPE_LABEL[epay]).toBe('電子支付')
    expect(TYPE_COLOR_VAR[epay]).not.toBe(TYPE_COLOR_VAR.cash)
    expect(TYPE_COLOR_VAR[epay]).not.toBe(TYPE_COLOR_VAR.bank)
  })
})
