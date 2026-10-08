/**
 * Service account 的 private key 從 JSON 金鑰檔搬到環境變數的路上，會被各種
 * 方式弄壞。OpenSSL 對這些只會回一句 `DECODER routines::unsupported`，完全
 * 看不出哪裡錯 —— 所以這裡自己判斷，並且把能救的格式救回來。
 *
 * 常見的壞法：
 *  1. 連同外層的雙引號一起貼進 Vercel 的環境變數欄位（dotenv 需要引號，
 *     但 Vercel 的輸入框是字面值，引號會變成金鑰的一部分）
 *  2. 換行還是字面上的 \n（從 JSON 直接複製時就是這樣）
 *  3. 經過兩層跳脫變成 \\n
 *  4. 整段 PEM 被 base64 包起來（有些人為了避開換行問題會這樣做）
 *  5. 只複製到中間那段 base64，漏了 BEGIN/END 標頭
 */

const PEM_BEGIN = /-----BEGIN ([A-Z ]*)PRIVATE KEY-----/
const PEM_END = /-----END ([A-Z ]*)PRIVATE KEY-----/

/** 去掉成對的外層引號（單引號或雙引號） */
function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim()
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if (trimmed.length >= 2 && (first === '"' || first === "'") && last === first) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** 把字面上的 \n（含被雙重跳脫的 \\n）還原成真的換行 */
function restoreNewlines(value: string): string {
  return value
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

/** 整段 PEM 被 base64 包起來的情況 */
function tryDecodeBase64Pem(value: string): string | null {
  const compact = value.replace(/\s/g, '')
  if (compact.length < 64 || !/^[A-Za-z0-9+/=]+$/.test(compact)) return null
  try {
    const decoded = Buffer.from(compact, 'base64').toString('utf8')
    return PEM_BEGIN.test(decoded) ? decoded : null
  } catch {
    return null
  }
}

/**
 * 盡力把環境變數裡的值整理成合法的 PEM。
 * 整不出來就回 null，由呼叫端給出具體的錯誤說明。
 */
export function normalizePrivateKey(raw: string | undefined): string | null {
  if (!raw) return null

  let key = restoreNewlines(stripWrappingQuotes(raw))

  if (!PEM_BEGIN.test(key)) {
    const decoded = tryDecodeBase64Pem(key)
    if (!decoded) return null
    key = restoreNewlines(decoded)
  }

  if (!PEM_END.test(key)) return null

  // PEM 的最後一行必須以換行結尾，否則部分 OpenSSL 版本會拒收
  return key.endsWith('\n') ? key : `${key}\n`
}

/**
 * 說明金鑰哪裡有問題。回傳的字串會直接顯示給使用者，
 * **絕對不能包含任何金鑰內容**。
 */
export function describePrivateKeyProblem(raw: string | undefined): string | null {
  if (!raw || raw.trim() === '') {
    return '沒有設定 GOOGLE_PRIVATE_KEY。'
  }

  if (normalizePrivateKey(raw) !== null) return null

  const cleaned = restoreNewlines(stripWrappingQuotes(raw))
  const hasBegin = PEM_BEGIN.test(cleaned)
  const hasEnd = PEM_END.test(cleaned)

  if (!hasBegin && !hasEnd) {
    return (
      'GOOGLE_PRIVATE_KEY 看起來不是 PEM 格式。請打開下載的 JSON 金鑰檔，' +
      '複製 "private_key" 的完整內容（要包含 -----BEGIN PRIVATE KEY----- 這一行）。'
    )
  }

  if (hasBegin && !hasEnd) {
    return (
      'GOOGLE_PRIVATE_KEY 只有開頭沒有結尾，應該是複製時被截斷了。' +
      '請確認最後一行 -----END PRIVATE KEY----- 也有貼進去。'
    )
  }

  return (
    'GOOGLE_PRIVATE_KEY 的格式不正確。貼到 Vercel 的環境變數時不要加外層引號，' +
    '直接貼 JSON 裡 private_key 的值即可（\\n 會自動還原成換行）。'
  )
}

/** OpenSSL 對格式錯誤的 PEM 只會丟這個，訊息本身毫無線索 */
export function isKeyDecodeError(error: unknown): boolean {
  const message = (error as Error)?.message ?? ''
  return /DECODER routines|unsupported|asn1|PEM routines|bad decrypt/i.test(message)
}
