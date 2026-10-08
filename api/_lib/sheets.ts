import { JWT } from 'google-auth-library'
import { columnLetter } from '../../shared/sheets-schema.js'
import { SheetsError } from './errors.js'
import {
  describePrivateKeyProblem,
  isKeyDecodeError,
  normalizePrivateKey,
} from './private-key.js'

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new SheetsError(
      `缺少環境變數 ${name}，請參考 .env.example 設定後重新啟動。`,
      500,
    )
  }
  return v
}

export function spreadsheetId(): string {
  return requireEnv('SHEET_ID')
}

/** 在 warm lambda 之間重用，省掉每次請求的 token 交換 */
let cachedClient: JWT | null = null

function client(): JWT {
  if (cachedClient) return cachedClient

  // 環境變數裡的金鑰可能帶著外層引號或字面上的 \n，先整理成合法的 PEM
  const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY)
  if (!privateKey) {
    throw new SheetsError(describePrivateKeyProblem(process.env.GOOGLE_PRIVATE_KEY)!, 500)
  }

  cachedClient = new JWT({
    email: requireEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    key: privateKey,
    scopes: SCOPES,
  })
  return cachedClient
}

async function authHeader(): Promise<string> {
  try {
    const token = await client().getAccessToken()
    if (!token.token) throw new Error('empty token')
    return `Bearer ${token.token}`
  } catch (err) {
    cachedClient = null
    if (err instanceof SheetsError) throw err

    // OpenSSL 對格式壞掉的 PEM 只會回 `DECODER routines::unsupported`，
    // 把它翻譯成看得懂、改得動的說明
    if (isKeyDecodeError(err)) {
      throw new SheetsError(
        describePrivateKeyProblem(process.env.GOOGLE_PRIVATE_KEY) ??
          'Google 無法讀取這把 service account 金鑰。請從 JSON 金鑰檔重新複製 private_key，' +
            '或在 GCP 上重新產生一把金鑰。',
        500,
      )
    }

    const message = (err as Error).message ?? ''
    if (/invalid_grant/i.test(message)) {
      throw new SheetsError(
        'Google 拒絕了這把金鑰（invalid_grant）。常見原因：金鑰已被刪除或停用、' +
          'service account 被移除，或伺服器時間不同步。請到 GCP 確認金鑰仍然有效。',
        500,
      )
    }
    if (/invalid_client|unauthorized_client/i.test(message)) {
      throw new SheetsError(
        'Google 不認得這個 service account。請確認 GOOGLE_SERVICE_ACCOUNT_EMAIL ' +
          '與金鑰來自同一個服務帳戶。',
        500,
      )
    }

    throw new SheetsError(`Google 認證失敗：${message}`, 500)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SHEETS_API}/${spreadsheetId()}${path}`, {
    ...init,
    headers: {
      Authorization: await authHeader(),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 403) {
      throw new SheetsError(
        '沒有權限存取這份 Google Sheet。請把 Sheet 以「編輯者」分享給 service account 的 email。',
        403,
      )
    }
    if (res.status === 404) {
      throw new SheetsError('找不到這份 Google Sheet，請確認 SHEET_ID。', 404)
    }
    throw new SheetsError(`Google Sheets API 錯誤 (${res.status}): ${body.slice(0, 500)}`, 502)
  }

  return (await res.json()) as T
}

/* ------------------------------------------------------------------ */
/* 讀                                                                   */
/* ------------------------------------------------------------------ */

function quoteTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`
}

export function fullRange(title: string): string {
  return `${quoteTitle(title)}!A:ZZ`
}

export async function getValues(title: string): Promise<unknown[][]> {
  const data = await call<{ values?: unknown[][] }>(
    `/values/${encodeURIComponent(fullRange(title))}`,
  )
  return data.values ?? []
}

/** 一次抓多個分頁，省掉來回往返（首頁要三張表） */
export async function batchGetValues(
  titles: readonly string[],
): Promise<Record<string, unknown[][]>> {
  const params = titles
    .map((t) => `ranges=${encodeURIComponent(fullRange(t))}`)
    .join('&')
  const data = await call<{ valueRanges?: { range: string; values?: unknown[][] }[] }>(
    `/values:batchGet?${params}&majorDimension=ROWS`,
  )
  const out: Record<string, unknown[][]> = {}
  titles.forEach((title, i) => {
    out[title] = data.valueRanges?.[i]?.values ?? []
  })
  return out
}

/* ------------------------------------------------------------------ */
/* 寫                                                                   */
/* ------------------------------------------------------------------ */

export async function appendRows(
  title: string,
  rows: (string | number)[][],
): Promise<void> {
  if (rows.length === 0) return
  await call(
    `/values/${encodeURIComponent(fullRange(title))}:append` +
      `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows }) },
  )
}

/** 覆寫指定列（rowNumber 是 Sheet 上看到的 1-based 列號） */
export async function updateRow(
  title: string,
  rowNumber: number,
  values: (string | number)[],
): Promise<void> {
  const range = `${quoteTitle(title)}!A${rowNumber}:${columnLetter(values.length - 1)}${rowNumber}`
  await call(
    `/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [values] }) },
  )
}

export async function updateRows(
  updates: readonly { title: string; rowNumber: number; values: (string | number)[] }[],
): Promise<void> {
  if (updates.length === 0) return
  await call(`/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: updates.map((u) => ({
        range: `${quoteTitle(u.title)}!A${u.rowNumber}:${columnLetter(u.values.length - 1)}${u.rowNumber}`,
        values: [u.values],
      })),
    }),
  })
}

/* ------------------------------------------------------------------ */
/* 分頁管理                                                             */
/* ------------------------------------------------------------------ */

export interface SheetMeta {
  sheetId: number
  title: string
}

export async function getSheetMeta(): Promise<SheetMeta[]> {
  const data = await call<{
    sheets?: { properties?: { sheetId?: number; title?: string } }[]
  }>(`?fields=sheets.properties(sheetId,title)`)
  return (data.sheets ?? [])
    .map((s) => s.properties)
    .filter((p): p is { sheetId: number; title: string } =>
      typeof p?.sheetId === 'number' && typeof p?.title === 'string',
    )
    .map((p) => ({ sheetId: p.sheetId, title: p.title }))
}

export async function addSheet(title: string): Promise<void> {
  await call(`:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title } } }],
    }),
  })
}

export async function renameSheet(sheetId: number, title: string): Promise<void> {
  await call(`:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId, title },
            fields: 'title',
          },
        },
      ],
    }),
  })
}

/** 凍結表頭列並粗體，純粹讓人直接開 Sheet 時好看 */
export async function formatHeader(sheetId: number, columnCount: number): Promise<void> {
  await call(`:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
      ],
    }),
  })
}

/** 刪除若干列（rowNumbers 為 1-based）。由大到小刪，避免索引位移。 */
export async function deleteRows(
  sheetId: number,
  rowNumbers: readonly number[],
): Promise<void> {
  if (rowNumbers.length === 0) return
  const sorted = [...new Set(rowNumbers)].sort((a, b) => b - a)
  await call(`:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: sorted.map((n) => ({
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n },
        },
      })),
    }),
  })
}

export async function writeHeaderRow(
  title: string,
  headers: readonly string[],
): Promise<void> {
  const range = `${quoteTitle(title)}!A1:${columnLetter(headers.length - 1)}1`
  await call(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [headers] }),
  })
}
