import type { z } from 'zod'
import {
  accountSchema,
  reviewSchema,
  settingSchema,
  snapshotSchema,
} from './model'

/**
 * 四個分頁的定義。`headers` 是「初始化時」寫入的表頭順序 —— 讀取時一律以
 * 分頁第一列實際的表頭為準，所以之後在 Google Sheet 上手動插入/搬動欄位，
 * App 仍然讀得懂。
 */
export const SHEETS = {
  accounts: {
    title: 'Accounts',
    headers: [
      'id',
      'name',
      'type',
      'currency',
      'institution',
      'is_liability',
      'sort_order',
      'status',
      'note',
      'created_at',
    ],
    schema: accountSchema,
  },
  snapshots: {
    title: 'Snapshots',
    headers: [
      'id',
      'review_id',
      'date',
      'account_id',
      'amount',
      'currency',
      'fx_rate',
      'amount_twd',
      'note',
      'created_at',
    ],
    schema: snapshotSchema,
  },
  reviews: {
    title: 'Reviews',
    headers: [
      'id',
      'date',
      'usd_twd_rate',
      'total_assets_twd',
      'total_liabilities_twd',
      'net_worth_twd',
      'note',
      'created_at',
    ],
    schema: reviewSchema,
  },
  settings: {
    title: 'Settings',
    headers: ['key', 'value'],
    schema: settingSchema,
  },
} as const satisfies Record<
  string,
  { title: string; headers: readonly string[]; schema: z.ZodTypeAny }
>

export type SheetKey = keyof typeof SHEETS

/* ------------------------------------------------------------------ */
/* 列 ⇄ 物件                                                            */
/* ------------------------------------------------------------------ */

/** 表頭正規化：容忍大小寫與空白差異（使用者可能手動改過表頭） */
export function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

export function rowToRecord(
  headers: readonly string[],
  row: readonly unknown[],
): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i]
    if (!key) continue
    record[key] = row[i] ?? ''
  }
  return record
}

function serializeCell(value: unknown): string | number {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return Number.isFinite(value) ? value : ''
  return String(value)
}

export function recordToRow(
  headers: readonly string[],
  obj: Record<string, unknown>,
): (string | number)[] {
  return headers.map((h) => serializeCell(obj[h]))
}

/** 一筆資料，連同它在 Google Sheet 上的列號（1-based，含表頭），更新/刪除時要用 */
export interface Located<T> {
  data: T
  rowNumber: number
}

export interface ParsedSheet<T> {
  headers: string[]
  records: Located<T>[]
  /** 解析失敗的列（例如使用者手動打壞了某格），不中斷整個請求 */
  skipped: { rowNumber: number; reason: string }[]
}

/**
 * 把整個分頁（含表頭列）轉成已驗證的物件陣列。
 * 單列解析失敗不會讓整個請求爆掉 —— 收進 `skipped` 讓呼叫端決定怎麼報。
 */
export function parseSheet<T extends z.ZodTypeAny>(
  values: unknown[][] | null | undefined,
  schema: T,
): ParsedSheet<z.infer<T>> {
  const all = values ?? []
  const headerRow = all[0]
  if (!headerRow) return { headers: [], records: [], skipped: [] }

  const headers = headerRow.map(normalizeHeader)
  const records: Located<z.infer<T>>[] = []
  const skipped: { rowNumber: number; reason: string }[] = []

  for (let i = 1; i < all.length; i++) {
    const raw = all[i]
    if (!raw || raw.every((c) => String(c ?? '').trim() === '')) continue // 空白列
    const rowNumber = i + 1 // Sheet 上看到的列號
    const parsed = schema.safeParse(rowToRecord(headers, raw))
    if (parsed.success) {
      records.push({ data: parsed.data, rowNumber })
    } else {
      skipped.push({
        rowNumber,
        reason: parsed.error.issues.map((is) => `${is.path.join('.')}: ${is.message}`).join('; '),
      })
    }
  }

  return { headers, records, skipped }
}

export function dataOf<T>(parsed: ParsedSheet<T>): T[] {
  return parsed.records.map((r) => r.data)
}

/** A1 欄位代號：0 → A, 25 → Z, 26 → AA */
export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}
