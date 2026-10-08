import { describe, expect, it } from 'vitest'
import { accountSchema, snapshotSchema } from './model.js'
import { columnLetter, parseSheet, recordToRow, SHEETS } from './sheets-schema.js'

const ACCOUNT_HEADERS = SHEETS.accounts.headers

describe('Sheet 列 ⇄ 物件', () => {
  it('來回轉換不掉資料', () => {
    const original = {
      id: 'acc_1',
      name: '玉山數位帳戶',
      type: 'bank',
      currency: 'TWD',
      institution: '玉山銀行',
      is_liability: false,
      sort_order: 3,
      status: 'active',
      note: '',
      created_at: '2026-10-01T00:00:00.000Z',
    }

    const row = recordToRow(ACCOUNT_HEADERS, original)
    const { records } = parseSheet([[...ACCOUNT_HEADERS], row], accountSchema)

    expect(records).toHaveLength(1)
    expect(records[0]!.data).toEqual(original)
    expect(records[0]!.rowNumber).toBe(2)
  })

  it('布林值以 TRUE/FALSE 寫入，讀回來還是布林', () => {
    const row = recordToRow(ACCOUNT_HEADERS, {
      id: 'acc_2',
      name: '台新信貸',
      type: 'loan',
      currency: 'TWD',
      institution: '',
      is_liability: true,
      sort_order: 1,
      status: 'active',
      note: '',
      created_at: '',
    })
    expect(row[ACCOUNT_HEADERS.indexOf('is_liability')]).toBe('TRUE')

    const { records } = parseSheet([[...ACCOUNT_HEADERS], row], accountSchema)
    expect(records[0]!.data.is_liability).toBe(true)
  })

  it('欄位被手動搬動順序後，仍以表頭為準讀得正確', () => {
    const reordered = ['name', 'id', 'is_liability', 'type', 'currency']
    const { records } = parseSheet(
      [reordered, ['中信活存', 'acc_3', 'FALSE', 'bank', 'TWD']],
      accountSchema,
    )
    expect(records[0]!.data.id).toBe('acc_3')
    expect(records[0]!.data.name).toBe('中信活存')
  })

  it('表頭大小寫或空白不同也認得', () => {
    const { records } = parseSheet(
      [['ID', ' Name ', 'Type'], ['acc_4', '永豐大戶', 'bank']],
      accountSchema,
    )
    expect(records[0]!.data.id).toBe('acc_4')
    expect(records[0]!.data.name).toBe('永豐大戶')
  })

  it('手動打上千分位的金額照樣讀得懂', () => {
    const headers = ['id', 'account_id', 'amount', 'fx_rate', 'amount_twd', 'currency']
    const { records } = parseSheet(
      [headers, ['snp_1', 'acc_1', '1,234,567', '1', '1234567', 'TWD']],
      snapshotSchema,
    )
    expect(records[0]!.data.amount).toBe(1234567)
  })

  it('空白列略過，壞掉的列收進 skipped 而不是整批失敗', () => {
    const { records, skipped } = parseSheet(
      [
        [...ACCOUNT_HEADERS],
        ['acc_ok', '正常帳戶', 'bank', 'TWD', '', 'FALSE', '1', 'active', '', ''],
        ['', '', '', '', '', '', '', '', '', ''],
        ['', '名稱沒有 id', 'bank', 'TWD', '', 'FALSE', '1', 'active', '', ''],
      ],
      accountSchema,
    )
    expect(records).toHaveLength(1)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.rowNumber).toBe(4)
  })

  it('未知的類型/幣別退回安全值，不讓一格打錯就讀不到整個帳戶', () => {
    const { records } = parseSheet(
      [['id', 'name', 'type', 'currency'], ['acc_5', '怪帳戶', 'spaceship', 'JPY']],
      accountSchema,
    )
    expect(records[0]!.data.type).toBe('other')
    expect(records[0]!.data.currency).toBe('TWD')
  })
})

describe('columnLetter', () => {
  it.each([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
    [51, 'AZ'],
    [52, 'BA'],
  ])('%i → %s', (index, letter) => {
    expect(columnLetter(index)).toBe(letter)
  })
})
