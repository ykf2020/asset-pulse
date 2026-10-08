import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashPin, issueToken, verifyPin, verifyToken } from '../../api/_lib/auth.js'

const SCRIPT = fileURLToPath(new URL('../../scripts/make-pin-hash.mjs', import.meta.url))

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-at-least-16-chars-long'
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('PIN', () => {
  it('同一組 PIN 每次 hash 的鹽都不同', () => {
    expect(hashPin('482913')).not.toBe(hashPin('482913'))
  })

  it('正確的 PIN 通過、錯的擋下', () => {
    process.env.APP_PIN_HASH = hashPin('482913')
    expect(verifyPin('482913')).toBe(true)
    expect(verifyPin('482914')).toBe(false)
    expect(verifyPin('')).toBe(false)
  })

  it('全形數字會被正規化，手機上不小心用全形也能解鎖', () => {
    process.env.APP_PIN_HASH = hashPin('1234')
    expect(verifyPin('１２３４')).toBe(true)
  })

  it('APP_PIN_HASH 格式壞掉時明確報錯，而不是默默放行', () => {
    process.env.APP_PIN_HASH = '亂打的東西'
    expect(() => verifyPin('482913')).toThrow(/APP_PIN_HASH/)
  })

  it('沒設 APP_PIN_HASH 時不會變成任何 PIN 都能進', () => {
    delete process.env.APP_PIN_HASH
    expect(() => verifyPin('482913')).toThrow(/APP_PIN_HASH/)
  })

  // `npm run pin` 是獨立的 .mjs，演算法必須跟 verifyPin 對得上
  it('npm run pin 產生的 hash 能被 verifyPin 驗過', () => {
    const output = execFileSync('node', [SCRIPT, '482913'], { encoding: 'utf8' })
    const hash = output.match(/APP_PIN_HASH=(\S+)/)?.[1]
    expect(hash).toBeDefined()

    process.env.APP_PIN_HASH = hash
    expect(verifyPin('482913')).toBe(true)
    expect(verifyPin('999999')).toBe(false)
  })
})

describe('Token', () => {
  it('自己簽的 token 驗得過', () => {
    expect(verifyToken(issueToken().token)).toBe(true)
  })

  it('亂七八糟的 token 擋下來', () => {
    expect(verifyToken(undefined)).toBe(false)
    expect(verifyToken('')).toBe(false)
    expect(verifyToken('沒有點號')).toBe(false)
    expect(verifyToken('abc.def')).toBe(false)
  })

  it('簽章被改過就不認', () => {
    const [payload] = issueToken().token.split('.')
    expect(verifyToken(`${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).toBe(false)
  })

  it('換了 AUTH_SECRET 之後舊 token 失效', () => {
    const { token } = issueToken()
    process.env.AUTH_SECRET = 'a-completely-different-secret-value'
    expect(verifyToken(token)).toBe(false)
  })

  it('過期的 token 擋下來', () => {
    const expired = Buffer.from(JSON.stringify({ exp: Date.now() - 1000 }), 'utf8').toString(
      'base64url',
    )
    // 用正確的金鑰簽一個已過期的 payload，確認檢查的是 exp 而不只是簽章
    const sig = crypto
      .createHmac('sha256', Buffer.from(process.env.AUTH_SECRET!, 'utf8'))
      .update(expired)
      .digest('base64url')
    expect(verifyToken(`${expired}.${sig}`)).toBe(false)
  })

  it('沒設 AUTH_SECRET 時直接報錯，不會退化成不驗簽', () => {
    delete process.env.AUTH_SECRET
    expect(() => issueToken()).toThrow(/AUTH_SECRET/)
  })
})
