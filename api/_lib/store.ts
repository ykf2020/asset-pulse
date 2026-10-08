import { customAlphabet } from 'nanoid'
import {
  appSettingsSchema,
  DEFAULT_SETTINGS,
  type Account,
  type AppSettings,
  type Review,
  type Setting,
  type Snapshot,
} from '../../shared/model.js'
import {
  dataOf,
  parseSheet,
  recordToRow,
  SHEETS,
  type Located,
  type ParsedSheet,
  type SheetKey,
} from '../../shared/sheets-schema.js'
import { HttpError } from './http.js'
import { appendRows, batchGetValues, updateRow, updateRows } from './sheets.js'

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)

export const newId = {
  account: () => `acc_${nano()}`,
  snapshot: () => `snp_${nano()}`,
  review: () => `rev_${nano()}`,
}

export function nowIso(): string {
  return new Date().toISOString()
}

/* ------------------------------------------------------------------ */
/* Table：一個分頁的內容 + 它實際的表頭順序                               */
/* ------------------------------------------------------------------ */

export interface Table<T> extends ParsedSheet<T> {
  key: SheetKey
  title: string
  /** 實際寫入時要用的欄位順序：分頁第一列的表頭；分頁還沒初始化就用預設順序 */
  writeHeaders: readonly string[]
}

function toTable<T>(key: SheetKey, parsed: ParsedSheet<T>): Table<T> {
  const def = SHEETS[key]
  return {
    ...parsed,
    key,
    title: def.title,
    writeHeaders: parsed.headers.length > 0 ? parsed.headers : def.headers,
  }
}

/** 分頁 key → 它裝的資料型別 */
export interface SheetData {
  accounts: Account
  snapshots: Snapshot
  reviews: Review
  settings: Setting
}

export type Workspace = { [K in SheetKey]: Table<SheetData[K]> }

/** 一次把四個分頁讀回來（單一 API 往返） */
export async function loadWorkspace(): Promise<Workspace> {
  const titles = (Object.keys(SHEETS) as SheetKey[]).map((k) => SHEETS[k].title)
  const values = await batchGetValues(titles)

  return {
    accounts: toTable('accounts', parseSheet(values[SHEETS.accounts.title], SHEETS.accounts.schema)),
    snapshots: toTable('snapshots', parseSheet(values[SHEETS.snapshots.title], SHEETS.snapshots.schema)),
    reviews: toTable('reviews', parseSheet(values[SHEETS.reviews.title], SHEETS.reviews.schema)),
    settings: toTable('settings', parseSheet(values[SHEETS.settings.title], SHEETS.settings.schema)),
  }
}

/** 只讀需要的分頁 */
export async function loadTables<K extends SheetKey>(
  keys: readonly K[],
): Promise<{ [P in K]: Table<SheetData[P]> }> {
  const values = await batchGetValues(keys.map((k) => SHEETS[k].title))
  const out = {} as { [P in K]: Table<SheetData[P]> }
  for (const key of keys) {
    out[key] = toTable(key, parseSheet(values[SHEETS[key].title], SHEETS[key].schema)) as Table<
      SheetData[K]
    >
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 寫入                                                                 */
/* ------------------------------------------------------------------ */

export async function appendToTable<T extends object>(
  table: Table<T>,
  items: readonly T[],
): Promise<void> {
  await appendRows(
    table.title,
    items.map((item) => recordToRow(table.writeHeaders, item as Record<string, unknown>)),
  )
}

export async function updateInTable<T extends object>(
  table: Table<T>,
  rowNumber: number,
  item: T,
): Promise<void> {
  await updateRow(
    table.title,
    rowNumber,
    recordToRow(table.writeHeaders, item as Record<string, unknown>),
  )
}

export async function updateManyInTable<T extends object>(
  table: Table<T>,
  items: readonly Located<T>[],
): Promise<void> {
  await updateRows(
    items.map((it) => ({
      title: table.title,
      rowNumber: it.rowNumber,
      values: recordToRow(table.writeHeaders, it.data as Record<string, unknown>),
    })),
  )
}

/* ------------------------------------------------------------------ */
/* 查找                                                                 */
/* ------------------------------------------------------------------ */

export function findById<T extends { id: string }>(
  table: Table<T>,
  id: string,
): Located<T> | undefined {
  return table.records.find((r) => r.data.id === id)
}

export function requireById<T extends { id: string }>(
  table: Table<T>,
  id: string,
  label: string,
): Located<T> {
  const found = findById(table, id)
  if (!found) throw new HttpError(`找不到指定的${label}（${id}）`, 404)
  return found
}

export function accountMap(table: Table<Account>): Map<string, Account> {
  return new Map(table.records.map((r) => [r.data.id, r.data]))
}

export function accountsOf(table: Table<Account>): Account[] {
  return dataOf(table).sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'zh-TW'),
  )
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export function readSettings(table: Table<Setting>): AppSettings {
  const raw: Record<string, string> = {}
  for (const { data } of table.records) {
    if (data.key) raw[data.key] = data.value
  }
  return appSettingsSchema.parse({ ...DEFAULT_SETTINGS, ...raw })
}

/** 逐一 upsert 設定值（筆數很少，直接做） */
export async function writeSettings(
  table: Table<Setting>,
  patch: Partial<Record<keyof AppSettings, string | number>>,
): Promise<void> {
  const updates: Located<Setting>[] = []
  const inserts: Setting[] = []

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const existing = table.records.find((r) => r.data.key === key)
    if (existing) {
      updates.push({ rowNumber: existing.rowNumber, data: { key, value: String(value) } })
    } else {
      inserts.push({ key, value: String(value) })
    }
  }

  if (updates.length) await updateManyInTable(table, updates)
  if (inserts.length) await appendToTable(table, inserts)
}
