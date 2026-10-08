/**
 * 拿 .env.local 的設定真的去連一次 Google Sheets，確認憑證與分享權限都對。
 *
 *   npm run check:google
 *
 * 只印出診斷結果，不會印出任何金鑰內容。
 */
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { JWT } from 'google-auth-library'
import {
  describePrivateKeyProblem,
  normalizePrivateKey,
} from '../api/_lib/private-key.js'

/* ---------------------------------------------------------------- */
/* 最小的 .env 解析                                                   */
/*                                                                   */
/* 只處理一行一個 KEY=VALUE 的情形 —— 金鑰在 .env.local 裡是單行（換行 */
/* 是字面上的 \n），引號與跳脫交給 normalizePrivateKey 處理。          */
/* ---------------------------------------------------------------- */

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch {
    return out
  }

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

const env = { ...loadEnvFile('.env.local'), ...process.env }

const ok = (s: string) => `\x1b[32m✓\x1b[0m ${s}`
const bad = (s: string) => `\x1b[31m✗\x1b[0m ${s}`
const info = (s: string) => `  ${s}`

let failed = false
function fail(message: string, hint?: string) {
  failed = true
  console.log(bad(message))
  if (hint) console.log(info(hint))
}

/* ---------------------------------------------------------------- */
/* 1. 環境變數格式                                                    */
/* ---------------------------------------------------------------- */

console.log('\n── 環境變數 ──')

const sheetId = env.SHEET_ID?.replace(/^["']|["']$/g, '').trim()
if (!sheetId) {
  fail('SHEET_ID 沒有設定')
} else if (!/^[A-Za-z0-9_-]{30,}$/.test(sheetId)) {
  fail(
    `SHEET_ID 看起來不像試算表 ID（${sheetId.length} 字元）`,
    '應該是網址 /spreadsheets/d/ 後面那一段，不是整個網址。',
  )
} else {
  console.log(ok(`SHEET_ID（${sheetId.length} 字元，結尾 …${sheetId.slice(-6)}）`))
}

const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.replace(/^["']|["']$/g, '').trim()
if (!email) {
  fail('GOOGLE_SERVICE_ACCOUNT_EMAIL 沒有設定')
} else if (!/@.+\.iam\.gserviceaccount\.com$/.test(email)) {
  fail(`GOOGLE_SERVICE_ACCOUNT_EMAIL 格式不對：${email}`, ' 應該長得像 xxx@專案.iam.gserviceaccount.com')
} else {
  console.log(ok(`GOOGLE_SERVICE_ACCOUNT_EMAIL = ${email}`))
}

const keyProblem = describePrivateKeyProblem(env.GOOGLE_PRIVATE_KEY)
const privateKey = normalizePrivateKey(env.GOOGLE_PRIVATE_KEY)
if (!privateKey) {
  fail('GOOGLE_PRIVATE_KEY 不是合法的 PEM', keyProblem ?? '')
} else {
  try {
    const keyObject = crypto.createPrivateKey(privateKey)
    // 指紋讓你能比對本機與 Vercel 上的是不是同一把，而不必把金鑰印出來
    const fingerprint = crypto
      .createHash('sha256')
      .update(crypto.createPublicKey(keyObject).export({ type: 'spki', format: 'der' }))
      .digest('hex')
      .slice(0, 16)
    console.log(ok(`GOOGLE_PRIVATE_KEY 是合法的 ${keyObject.asymmetricKeyType?.toUpperCase()} 金鑰`))
    console.log(info(`指紋 ${fingerprint}（拿來比對 Vercel 上的是不是同一把）`))
  } catch (err) {
    fail(`GOOGLE_PRIVATE_KEY OpenSSL 收不下：${(err as Error).message}`)
  }
}

for (const name of ['APP_PIN_HASH', 'AUTH_SECRET'] as const) {
  if (env[name]) console.log(ok(`${name} 已設定`))
  else fail(`${name} 沒有設定`, '用 `npm run pin` 產生')
}

if (failed) {
  console.log('\n先把上面的問題修好再跑一次。\n')
  process.exit(1)
}

/* ---------------------------------------------------------------- */
/* 2. 真的跟 Google 要 token                                          */
/* ---------------------------------------------------------------- */

console.log('\n── Google 認證 ──')

const jwt = new JWT({
  email,
  key: privateKey!,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

let token: string
try {
  const result = await jwt.getAccessToken()
  if (!result.token) throw new Error('沒拿到 token')
  token = result.token
  console.log(ok('取得 access token'))
} catch (err) {
  const message = (err as Error).message
  console.log(bad(`認證失敗：${message}`))
  if (/invalid_grant/i.test(message)) {
    console.log(info('金鑰可能已被刪除或停用，或這個 service account 已不存在。'))
  }
  if (/DECODER|PEM/i.test(message)) {
    console.log(info('金鑰格式問題 —— 請從 JSON 金鑰檔重新複製 private_key。'))
  }
  process.exit(1)
}

/* ---------------------------------------------------------------- */
/* 3. 真的去讀那份試算表                                              */
/* ---------------------------------------------------------------- */

console.log('\n── Google Sheet 存取 ──')

const res = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=properties.title,sheets.properties(title,sheetId)`,
  { headers: { Authorization: `Bearer ${token}` } },
)

if (res.status === 403) {
  console.log(bad('沒有權限讀取這份試算表'))
  console.log(info(`請打開試算表 → 右上角「共用」→ 把下面這個 email 加為「編輯者」：`))
  console.log(info(`\x1b[1m${email}\x1b[0m`))
  process.exit(1)
}
if (res.status === 404) {
  console.log(bad('找不到這份試算表'))
  console.log(info('SHEET_ID 可能抄錯了，或試算表已被刪除。'))
  process.exit(1)
}
if (!res.ok) {
  console.log(bad(`Google Sheets API 回 ${res.status}`))
  console.log(info((await res.text()).slice(0, 300)))
  process.exit(1)
}

const data = (await res.json()) as {
  properties?: { title?: string }
  sheets?: { properties?: { title?: string } }[]
}

console.log(ok(`讀得到試算表「${data.properties?.title ?? '(無標題)'}」`))

const tabs = (data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean)
console.log(info(`現有分頁：${tabs.length ? tabs.join('、') : '(沒有)'}`))

const REQUIRED = ['Accounts', 'Snapshots', 'Reviews', 'Settings']
const missing = REQUIRED.filter((t) => !tabs.includes(t))

// 確認是「可寫」而不只是「可讀」——分享成唯讀的話這裡才會發現。
// 用「把標題設成它原本的標題」當探針：是真的寫入請求，但不會改變任何東西。
const probe = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          updateSpreadsheetProperties: {
            properties: { title: data.properties?.title ?? 'assets' },
            fields: 'title',
          },
        },
      ],
    }),
  },
)
if (probe.ok) {
  console.log(ok('有寫入權限'))
} else if (probe.status === 403) {
  console.log(bad('只有讀取權限'))
  console.log(info(`請把 ${email} 的權限從「檢視者」改成「編輯者」。`))
  process.exit(1)
} else {
  console.log(bad(`寫入測試回 ${probe.status}`))
  console.log(info((await probe.text()).slice(0, 300)))
  process.exit(1)
}

console.log('')
if (missing.length === 0) {
  console.log('\x1b[32m全部正常，可以開始用了。\x1b[0m\n')
} else {
  console.log(`\x1b[33m還缺分頁：${missing.join('、')}\x1b[0m`)
  console.log('開啟 App 後按「幫我建立分頁」即可，資料不會被動到。\n')
}
