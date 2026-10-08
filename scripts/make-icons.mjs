#!/usr/bin/env node
/**
 * 產生 PWA 圖示（public/icon-*.png、apple-touch-icon.png）。
 *
 *   node scripts/make-icons.mjs
 *
 * 刻意不引入任何圖形函式庫 —— 直接寫 PNG 位元組就夠了，圖示本身只是
 * 一個品牌藍底 + 白色折線脈衝，改色改形狀都在下面幾個常數裡。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const BRAND = [42, 120, 214] // #2a78d6
const INK = [255, 255, 255]

/* ----------------------------- PNG 編碼 ----------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // 每條掃描線前面要加一個 filter byte（0 = None）
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ----------------------------- 繪圖 ----------------------------- */

/** 點到線段的距離，用來畫有厚度的折線 */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/**
 * @param size 邊長
 * @param inset 內容距離邊緣的比例（maskable 要留安全區）
 * @param rounded 是否把底切成圓角（一般圖示用；maskable 要滿版）
 */
function drawIcon(size, { inset = 0.18, rounded = true } = {}) {
  const rgba = Buffer.alloc(size * size * 4)
  const radius = size * 0.22

  // 折線的錨點，用 0–1 的相對座標描述，縮放到任何尺寸都一致
  const anchors = [
    [0.0, 0.62],
    [0.22, 0.62],
    [0.36, 0.2],
    [0.52, 0.88],
    [0.66, 0.44],
    [0.78, 0.44],
    [1.0, 0.44],
  ]

  const contentSize = size * (1 - inset * 2)
  const offset = size * inset
  const points = anchors.map(([x, y]) => [offset + x * contentSize, offset + y * contentSize])
  const strokeHalf = size * 0.045

  // 超取樣：每個像素取 2×2 個樣本，邊緣才不會鋸齒
  const SAMPLES = 2
  const step = 1 / SAMPLES

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgCoverage = 0
      let lineCoverage = 0

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) * step
          const py = y + (sy + 0.5) * step

          if (rounded ? insideRoundedRect(px, py, size, radius) : true) bgCoverage++

          let minDist = Infinity
          for (let i = 0; i < points.length - 1; i++) {
            const d = distanceToSegment(px, py, ...points[i], ...points[i + 1])
            if (d < minDist) minDist = d
          }
          if (minDist <= strokeHalf) lineCoverage++
        }
      }

      const total = SAMPLES * SAMPLES
      const bgAlpha = bgCoverage / total
      const lineAlpha = (lineCoverage / total) * bgAlpha

      const idx = (y * size + x) * 4
      const r = BRAND[0] * (1 - lineAlpha) + INK[0] * lineAlpha
      const g = BRAND[1] * (1 - lineAlpha) + INK[1] * lineAlpha
      const b = BRAND[2] * (1 - lineAlpha) + INK[2] * lineAlpha

      rgba[idx] = Math.round(r)
      rgba[idx + 1] = Math.round(g)
      rgba[idx + 2] = Math.round(b)
      rgba[idx + 3] = Math.round(bgAlpha * 255)
    }
  }

  return encodePng(size, size, rgba)
}

function insideRoundedRect(x, y, size, radius) {
  if (x < radius && y < radius) return Math.hypot(radius - x, radius - y) <= radius
  if (x > size - radius && y < radius) return Math.hypot(x - (size - radius), radius - y) <= radius
  if (x < radius && y > size - radius) return Math.hypot(radius - x, y - (size - radius)) <= radius
  if (x > size - radius && y > size - radius)
    return Math.hypot(x - (size - radius), y - (size - radius)) <= radius
  return true
}

/* ----------------------------- 輸出 ----------------------------- */

mkdirSync(OUT_DIR, { recursive: true })

const outputs = [
  ['icon-192.png', drawIcon(192)],
  ['icon-512.png', drawIcon(512)],
  // maskable：滿版、內容縮在中央 80% 安全區內，系統怎麼裁都不會切到圖形
  ['icon-maskable-512.png', drawIcon(512, { inset: 0.28, rounded: false })],
  // iOS 會自己套圓角，所以這張不自己切
  ['apple-touch-icon.png', drawIcon(180, { rounded: false })],
]

for (const [name, buffer] of outputs) {
  writeFileSync(join(OUT_DIR, name), buffer)
  console.log(`✓ public/${name}  (${(buffer.length / 1024).toFixed(1)} KB)`)
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#2a78d6"/>
  <polyline points="18,62 34,62 44,30 56,80 66,52 74,52 86,52"
    fill="none" stroke="#fff" stroke-width="9"
    stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`
writeFileSync(join(OUT_DIR, 'favicon.svg'), favicon)
console.log('✓ public/favicon.svg')
