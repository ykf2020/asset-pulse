import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import handler from '../../api/auth.js'
import { hashPin } from '../../api/_lib/auth.js'

/**
 * 直接把 serverless function 叫起來，確認它在真實環境會怎麼回應。
 * 這支測試的存在理由：部署後出現 FUNCTION_INVOCATION_FAILED（函式整個掛掉，
 * 而不是我們自己回傳的錯誤），本地必須能重現同一條路徑才查得到。
 */

interface MockResponse {
  res: VercelResponse
  statusCode: number | null
  body: unknown
  headers: Record<string, string>
}

function mockRes(): MockResponse {
  const state: MockResponse = {
    statusCode: null,
    body: undefined,
    headers: {},
    res: null as unknown as VercelResponse,
  }

  const res = {
    writableEnded: false,
    status(code: number) {
      state.statusCode = code
      return res
    },
    json(payload: unknown) {
      state.body = payload
      res.writableEnded = true
      return res
    },
    end() {
      res.writableEnded = true
      return res
    },
    setHeader(key: string, value: string) {
      state.headers[key] = value
      return res
    },
  }

  state.res = res as unknown as VercelResponse
  return state
}

function mockReq(method: string, body?: unknown): VercelRequest {
  return {
    method,
    query: {},
    headers: { 'content-type': 'application/json' },
    body,
    socket: { remoteAddress: '203.0.113.1' },
  } as unknown as VercelRequest
}

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-at-least-16-chars-long'
  process.env.APP_PIN_HASH = hashPin('482913')
  process.env.SHEET_ID = 'sheet-id'
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'x@y.iam.gserviceaccount.com'
  process.env.GOOGLE_PRIVATE_KEY = PEM
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('POST /api/auth', () => {
  it('正確 PIN 回傳 token', async () => {
    const out = mockRes()
    await handler(mockReq('POST', { pin: '482913' }), out.res)

    expect(out.statusCode).toBe(200)
    expect(out.body).toMatchObject({ token: expect.any(String) })
  })

  it('錯誤 PIN 回 401 而不是讓函式掛掉', async () => {
    const out = mockRes()
    await handler(mockReq('POST', { pin: '000000' }), out.res)

    expect(out.statusCode).toBe(401)
    expect(out.body).toEqual({ error: 'PIN 不正確' })
  })

  it('body 是字串（未被框架 parse）時照樣處理', async () => {
    const out = mockRes()
    await handler(mockReq('POST', JSON.stringify({ pin: '482913' })), out.res)

    expect(out.statusCode).toBe(200)
  })

  it('body 缺少 pin 時回 400', async () => {
    const out = mockRes()
    await handler(mockReq('POST', {}), out.res)

    expect(out.statusCode).toBe(400)
  })

  it('GET 在設定齊全時回報 configured', async () => {
    const out = mockRes()
    await handler(mockReq('GET'), out.res)

    expect(out.statusCode).toBe(200)
    expect(out.body).toMatchObject({
      configured: true,
      checks: { pin: true, sheetId: true, serviceAccountEmail: true, privateKey: true },
    })
  })

  it('GET 指出是哪一項環境變數有問題', async () => {
    // 貼進 Vercel 時連外層引號一起帶進來 —— 這個版本是可以自動救回來的
    process.env.GOOGLE_PRIVATE_KEY = `"${PEM.replace(/\n/g, '\\n')}"`
    const quoted = mockRes()
    await handler(mockReq('GET'), quoted.res)
    expect(quoted.body).toMatchObject({ configured: true })

    // 真的壞掉的金鑰要被指出來，並附上可行動的說明
    process.env.GOOGLE_PRIVATE_KEY = '只複製到一半的東西'
    process.env.SHEET_ID = ''
    const broken = mockRes()
    await handler(mockReq('GET'), broken.res)

    expect(broken.body).toMatchObject({
      configured: false,
      checks: { pin: true, sheetId: false, privateKey: false },
    })
    expect((broken.body as { hint: string }).hint).toMatch(/BEGIN PRIVATE KEY/)
  })

  it('健檢回應不含任何環境變數的內容', async () => {
    const out = mockRes()
    await handler(mockReq('GET'), out.res)

    const serialized = JSON.stringify(out.body)
    expect(serialized).not.toContain('MII')
    expect(serialized).not.toContain(process.env.APP_PIN_HASH!)
    expect(serialized).not.toContain('sheet-id')
  })

  it('環境變數沒設好時回 500 的 JSON，而不是無訊息崩潰', async () => {
    delete process.env.APP_PIN_HASH
    const out = mockRes()
    await handler(mockReq('POST', { pin: '482913' }), out.res)

    expect(out.statusCode).toBe(500)
    expect(out.body).toMatchObject({ error: expect.stringContaining('APP_PIN_HASH') })
  })
})
