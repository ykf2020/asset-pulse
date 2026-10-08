#!/usr/bin/env node
/**
 * 產生 APP_PIN_HASH 與 AUTH_SECRET。
 *
 *   npm run pin -- 123456
 *   npm run pin            # 互動式輸入
 *
 * 演算法必須與 api/_lib/auth.ts 的 hashPin() 一致。
 */
import crypto from 'node:crypto'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

function hashPin(pin) {
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(pin.normalize('NFKC'), salt, 32)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

let pin = process.argv[2]

if (!pin) {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  pin = (await rl.question('請設定一組 PIN（至少 4 碼）：')).trim()
  rl.close()
}

if (!pin || pin.length < 4) {
  console.error('✗ PIN 至少需要 4 碼')
  process.exit(1)
}

console.log('\n把下面兩行貼進 .env.local 和 Vercel 的環境變數：\n')
console.log(`APP_PIN_HASH=${hashPin(pin)}`)
console.log(`AUTH_SECRET=${crypto.randomBytes(32).toString('base64url')}`)
console.log('')
