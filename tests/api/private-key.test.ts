import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  describePrivateKeyProblem,
  isKeyDecodeError,
  normalizePrivateKey,
} from '../../api/_lib/private-key.js'

/**
 * 這組測試對應一次真實的部署事故：金鑰貼到 Vercel 之後，Google 回
 * `error:1E08010C:DECODER routines::unsupported` —— OpenSSL 看不懂那段 PEM，
 * 而且它的錯誤訊息完全不說哪裡錯。
 *
 * 每個案例都用「真的 RSA 金鑰」去弄壞再還原，而且還原後會丟給
 * `crypto.createPrivateKey()` 驗一次 —— 只有 OpenSSL 自己收得下去才算過，
 * 不是比對字串長得像而已。
 */

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

/** JSON 金鑰檔裡的樣子：換行是字面上的 \n */
const JSON_STYLE = PEM.replace(/\n/g, '\\n')

function isUsableByOpenSSL(pem: string): boolean {
  try {
    crypto.createPrivateKey(pem)
    return true
  } catch {
    return false
  }
}

describe('normalizePrivateKey：救回各種貼壞的金鑰', () => {
  it.each([
    ['原本就是正確的 PEM（真換行）', PEM],
    ['JSON 裡的樣子（字面 \\n）', JSON_STYLE],
    ['連雙引號一起貼進來', `"${JSON_STYLE}"`],
    ['連單引號一起貼進來', `'${JSON_STYLE}'`],
    ['雙引號 + 真換行', `"${PEM}"`],
    ['前後有多餘空白與換行', `\n   ${JSON_STYLE}  \n`],
    ['被兩層跳脫成 \\\\n', PEM.replace(/\n/g, '\\\\n')],
    ['Windows 風格的 CRLF', PEM.replace(/\n/g, '\r\n')],
    ['整段 PEM 被 base64 包起來', Buffer.from(PEM, 'utf8').toString('base64')],
    ['結尾少了換行', PEM.trimEnd()],
  ])('%s', (_label, raw) => {
    const normalized = normalizePrivateKey(raw)

    expect(normalized).not.toBeNull()
    expect(isUsableByOpenSSL(normalized!)).toBe(true)
    expect(describePrivateKeyProblem(raw)).toBeNull()

    // 還原出來的金鑰必須跟原本那把一模一樣，不能只是「形狀對」
    expect(crypto.createPrivateKey(normalized!).export({ type: 'pkcs8', format: 'pem' })).toBe(PEM)
  })
})

describe('describePrivateKeyProblem：講得出問題在哪', () => {
  it('沒設定時直接說沒設定', () => {
    expect(describePrivateKeyProblem(undefined)).toMatch(/沒有設定/)
    expect(describePrivateKeyProblem('   ')).toMatch(/沒有設定/)
  })

  it('整段不是 PEM 時，告訴使用者該去 JSON 金鑰檔複製什麼', () => {
    const message = describePrivateKeyProblem('這不是金鑰')
    expect(message).toMatch(/BEGIN PRIVATE KEY/)
  })

  it('只複製到一半（缺 END）時明確指出被截斷', () => {
    const truncated = PEM.split('\n').slice(0, 5).join('\n')
    expect(describePrivateKeyProblem(truncated)).toMatch(/截斷|END PRIVATE KEY/)
  })

  it('只有中間的 base64、漏掉標頭時不會誤判成正常', () => {
    const body = PEM.replace(/-----[^-]+-----/g, '').trim()
    expect(normalizePrivateKey(body)).toBeNull()
    expect(describePrivateKeyProblem(body)).not.toBeNull()
  })

  it('錯誤說明裡絕對不能出現金鑰內容', () => {
    const secretLine = PEM.split('\n')[1]!
    for (const raw of ['這不是金鑰', PEM.split('\n').slice(0, 5).join('\n'), '']) {
      const message = describePrivateKeyProblem(raw) ?? ''
      expect(message).not.toContain(secretLine)
      expect(message).not.toContain('MII')
    }
  })
})

describe('isKeyDecodeError', () => {
  it('認得 OpenSSL 那句毫無線索的錯誤', () => {
    expect(isKeyDecodeError(new Error('error:1E08010C:DECODER routines::unsupported'))).toBe(true)
    expect(isKeyDecodeError(new Error('error:0909006C:PEM routines:get_name:no start line'))).toBe(
      true,
    )
  })

  it('不會把無關的錯誤也當成金鑰問題', () => {
    expect(isKeyDecodeError(new Error('getaddrinfo ENOTFOUND'))).toBe(false)
    expect(isKeyDecodeError(undefined)).toBe(false)
  })
})

describe('還原後的金鑰能真的拿來簽 JWT', () => {
  // Google 的 service account 認證就是用這把金鑰對 JWT assertion 做 RS256 簽章。
  // 這裡離線重現同一件事：金鑰只要有一點壞掉，sign 就會丟 DECODER 錯誤。
  it.each([
    ['雙引號包住的 JSON 樣式', `"${JSON_STYLE}"`],
    ['base64 包起來的 PEM', Buffer.from(PEM, 'utf8').toString('base64')],
  ])('%s 還原後簽得出可驗證的簽章', (_label, raw) => {
    const normalized = normalizePrivateKey(raw)!
    const assertion = Buffer.from('{"alg":"RS256"}.{"iss":"test"}', 'utf8')

    const signature = crypto.sign('RSA-SHA256', assertion, normalized)
    const publicKey = crypto.createPublicKey(normalized)

    expect(crypto.verify('RSA-SHA256', assertion, publicKey, signature)).toBe(true)
  })
})
