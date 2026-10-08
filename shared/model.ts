import { z } from 'zod'

/* ------------------------------------------------------------------ */
/* 列舉與中文標籤                                                       */
/* ------------------------------------------------------------------ */

/**
 * 順序大致依流動性排 —— 它同時決定了新增帳戶時下拉選單的順序、帳戶列表的
 * 分組順序，以及配置圓環各段的排列順序。
 */
export const ACCOUNT_TYPES = [
  'bank',
  'epay',
  'cash',
  'stock',
  'futures',
  'crypto',
  'property',
  'vehicle',
  'loan',
  'other',
] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  bank: '銀行帳戶',
  epay: '電子支付',
  cash: '現金',
  stock: '證券',
  futures: '期貨戶',
  crypto: '虛擬貨幣',
  property: '房產',
  vehicle: '車輛',
  loan: '貸款',
  other: '其他',
}

/** 每種類型輸入時的提示，讓「填哪個數字」沒有疑問 */
export const ACCOUNT_TYPE_HINT: Partial<Record<AccountType, string>> = {
  epay: '填入儲值餘額，例如 iPASS MONEY、LINE Pay、街口支付',
  futures: '填入帳戶權益數',
  crypto: '填入總資產估值',
  loan: '填入目前剩餘本金',
  property: '填入目前估值',
  vehicle: '填入目前估值',
}

/** 預設為負債的類型 */
export const LIABILITY_TYPES: readonly AccountType[] = ['loan']

/** 這些類型新增時預設用 USD 計價 */
export const USD_DEFAULT_TYPES: readonly AccountType[] = ['crypto']

export const CURRENCIES = ['TWD', 'USD'] as const
export type Currency = (typeof CURRENCIES)[number]

export const CURRENCY_LABEL: Record<Currency, string> = {
  TWD: '新台幣',
  USD: '美元',
}

export const ACCOUNT_STATUSES = ['active', 'archived'] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

export const BASE_CURRENCY: Currency = 'TWD'

/* ------------------------------------------------------------------ */
/* 欄位小工具                                                           */
/* ------------------------------------------------------------------ */

/** Google Sheet 讀回來一律是字串（或空字串），所以全部用 coerce + 預設值 */
const sheetString = z.coerce.string().default('')
const sheetNumber = z.preprocess((v) => {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return undefined
  const cleaned = v.replace(/[,\s$NT]/gi, '')
  if (cleaned === '') return undefined
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : undefined
}, z.number())

const sheetBoolean = z.preprocess((v) => {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim().toUpperCase()
  if (s === 'TRUE' || s === 'YES' || s === '1' || s === 'Y') return true
  if (s === 'FALSE' || s === 'NO' || s === '0' || s === 'N' || s === '') return false
  return undefined
}, z.boolean())

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD')

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export const accountSchema = z.object({
  id: z.string().min(1),
  name: sheetString.pipe(z.string().min(1, '帳戶名稱不可空白')),
  type: z.enum(ACCOUNT_TYPES).catch('other'),
  currency: z.enum(CURRENCIES).catch('TWD'),
  institution: sheetString,
  is_liability: sheetBoolean.catch(false),
  sort_order: sheetNumber.catch(0),
  status: z.enum(ACCOUNT_STATUSES).catch('active'),
  note: sheetString,
  created_at: sheetString,
})
export type Account = z.infer<typeof accountSchema>

/** 建立帳戶時由前端送出的內容 */
export const accountInputSchema = z.object({
  name: z.string().trim().min(1, '請輸入帳戶名稱').max(60),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.enum(CURRENCIES),
  institution: z.string().trim().max(60).default(''),
  is_liability: z.boolean(),
  sort_order: z.number().int().optional(),
  note: z.string().trim().max(200).default(''),
})
export type AccountInput = z.infer<typeof accountInputSchema>

export const accountPatchSchema = accountInputSchema
  .partial()
  .extend({ status: z.enum(ACCOUNT_STATUSES).optional() })
export type AccountPatch = z.infer<typeof accountPatchSchema>

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

export const snapshotSchema = z.object({
  id: z.string().min(1),
  review_id: sheetString,
  date: sheetString,
  account_id: sheetString,
  amount: sheetNumber.catch(0),
  currency: z.enum(CURRENCIES).catch('TWD'),
  fx_rate: sheetNumber.catch(1),
  amount_twd: sheetNumber.catch(0),
  note: sheetString,
  created_at: sheetString,
})
export type Snapshot = z.infer<typeof snapshotSchema>

/* ------------------------------------------------------------------ */
/* Reviews（盤點場次）                                                  */
/* ------------------------------------------------------------------ */

export const reviewSchema = z.object({
  id: z.string().min(1),
  date: sheetString,
  usd_twd_rate: sheetNumber.catch(1),
  total_assets_twd: sheetNumber.catch(0),
  total_liabilities_twd: sheetNumber.catch(0),
  net_worth_twd: sheetNumber.catch(0),
  note: sheetString,
  created_at: sheetString,
})
export type Review = z.infer<typeof reviewSchema>

/** 盤點時單一帳戶的輸入 */
export const reviewEntryInputSchema = z.object({
  account_id: z.string().min(1),
  amount: z.number().finite(),
  note: z.string().trim().max(200).default(''),
})
export type ReviewEntryInput = z.infer<typeof reviewEntryInputSchema>

/** 送出一次盤點 */
export const reviewInputSchema = z.object({
  date: isoDate,
  usd_twd_rate: z.number().positive('匯率需大於 0'),
  note: z.string().trim().max(200).default(''),
  entries: z.array(reviewEntryInputSchema).min(1, '至少要填一個帳戶'),
})
export type ReviewInput = z.infer<typeof reviewInputSchema>

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const settingSchema = z.object({
  key: sheetString,
  value: sheetString,
})
export type Setting = z.infer<typeof settingSchema>

export const appSettingsSchema = z.object({
  /** 幾天沒更新就標示「待更新」 */
  stale_days: z.coerce.number().int().min(1).max(365).catch(10),
  /** 0=週日 … 6=週六，盤點提醒日 */
  review_weekday: z.coerce.number().int().min(0).max(6).catch(0),
  base_currency: z.enum(CURRENCIES).catch('TWD'),
})
export type AppSettings = z.infer<typeof appSettingsSchema>

export const DEFAULT_SETTINGS: AppSettings = {
  stale_days: 10,
  review_weekday: 0,
  base_currency: 'TWD',
}
