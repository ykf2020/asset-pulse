import crypto from 'node:crypto'
import type { VercelRequest } from '@vercel/node'
import { HttpError } from './errors.js'
import type { Handler } from './http.js'

const TOKEN_TTL_DAYS = 90

/* ------------------------------------------------------------------ */
/* PIN                                                                 */
/* ------------------------------------------------------------------ */

/** `APP_PIN_HASH` 格式：scrypt$<saltHex>$<hashHex>，用 `npm run pin` 產生 */
export function hashPin(pin: string, salt?: Buffer): string {
  const s = salt ?? crypto.randomBytes(16)
  const derived = crypto.scryptSync(pin.normalize('NFKC'), s, 32)
  return `scrypt$${s.toString('hex')}$${derived.toString('hex')}`
}

export function verifyPin(pin: string): boolean {
  const stored = process.env.APP_PIN_HASH
  if (!stored) throw new HttpError('伺服器尚未設定 APP_PIN_HASH', 500)

  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) {
    throw new HttpError('APP_PIN_HASH 格式不正確，請用 `npm run pin` 重新產生', 500)
  }

  const expected = Buffer.from(hashHex, 'hex')
  const actual = crypto.scryptSync(pin.normalize('NFKC'), Buffer.from(saltHex, 'hex'), 32)
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

/* ------------------------------------------------------------------ */
/* Token（HMAC 簽章，不需要 DB）                                         */
/* ------------------------------------------------------------------ */

function secret(): Buffer {
  const s = process.env.AUTH_SECRET
  if (!s || s.length < 16) {
    throw new HttpError('伺服器尚未設定 AUTH_SECRET（至少 16 字元）', 500)
  }
  return Buffer.from(s, 'utf8')
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function sign(payload: string): string {
  return b64url(crypto.createHmac('sha256', secret()).update(payload).digest())
}

export function issueToken(): { token: string; expiresAt: string } {
  const exp = Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  const payload = b64url(Buffer.from(JSON.stringify({ exp }), 'utf8'))
  return {
    token: `${payload}.${sign(payload)}`,
    expiresAt: new Date(exp).toISOString(),
  }
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false

  const expected = Buffer.from(sign(payload), 'utf8')
  const actual = Buffer.from(signature, 'utf8')
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return false
  }

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof exp === 'number' && Date.now() < exp
  } catch {
    return false
  }
}

function bearerToken(req: VercelRequest): string | undefined {
  const header = req.headers.authorization
  if (!header) return undefined
  const [scheme, value] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' ? value : undefined
}

/** 包住需要登入的 handler */
export function requireAuth(handler: Handler): Handler {
  return async (req, res) => {
    if (!verifyToken(bearerToken(req))) {
      throw new HttpError('請先解鎖（PIN 無效或已過期）', 401)
    }
    return handler(req, res)
  }
}

export function requireAuthAll(
  handlers: Partial<Record<string, Handler>>,
): Partial<Record<string, Handler>> {
  return Object.fromEntries(
    Object.entries(handlers).map(([method, h]) => [method, requireAuth(h!)]),
  )
}

/* ------------------------------------------------------------------ */
/* 登入速率限制（單一 lambda 記憶體內，夠擋住隨手猜 PIN）                 */
/* ------------------------------------------------------------------ */

const attempts = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 8

export function checkRateLimit(req: VercelRequest): void {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'

  const now = Date.now()
  const entry = attempts.get(ip)

  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return
  }

  entry.count += 1
  if (entry.count > MAX_ATTEMPTS) {
    const mins = Math.ceil((entry.resetAt - now) / 60000)
    throw new HttpError(`嘗試次數過多，請 ${mins} 分鐘後再試`, 429)
  }
}

export function clearRateLimit(req: VercelRequest): void {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  attempts.delete(ip)
}
