import { requireAuthAll } from './_lib/auth'
import { route } from './_lib/http'
import { loadTables } from './_lib/store'
import { dataOf } from '../shared/sheets-schema'
import type { Review } from '../shared/model'

const SOURCE_URL = 'https://open.er-api.com/v6/latest/USD'
const CACHE_MS = 30 * 60 * 1000

interface FxResult {
  rate: number
  /** live = 剛抓到的即時匯率；last_review = 退回上次盤點用的匯率；fallback = 內建保底值 */
  source: 'live' | 'last_review' | 'fallback'
  asOf: string
  note?: string
}

let cache: { value: FxResult; at: number } | null = null

async function fetchLiveRate(): Promise<FxResult | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(SOURCE_URL, { signal: controller.signal })
    clearTimeout(timer)

    if (!res.ok) return null
    const data = (await res.json()) as {
      result?: string
      rates?: Record<string, number>
      time_last_update_utc?: string
    }
    const rate = data.rates?.TWD
    if (data.result !== 'success' || typeof rate !== 'number' || rate <= 0) return null

    return {
      rate: Math.round(rate * 1000) / 1000,
      source: 'live',
      asOf: data.time_last_update_utc ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * GET /api/fx — 取得盤點時要用的 USD/TWD 匯率。
 * 抓不到就退回上次盤點使用的匯率，並在 note 提示使用者確認。
 */
export default route(
  requireAuthAll({
    GET: async () => {
      if (cache && Date.now() - cache.at < CACHE_MS) return cache.value

      const live = await fetchLiveRate()
      if (live) {
        cache = { value: live, at: Date.now() }
        return live
      }

      const { reviews } = await loadTables(['reviews'])
      const latest: Review | undefined = dataOf(reviews)
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))[0]

      if (latest && latest.usd_twd_rate > 0) {
        return {
          rate: latest.usd_twd_rate,
          source: 'last_review',
          asOf: latest.date,
          note: '無法取得即時匯率，已帶入上次盤點使用的匯率，請確認。',
        } satisfies FxResult
      }

      return {
        rate: 32,
        source: 'fallback',
        asOf: new Date().toISOString(),
        note: '無法取得即時匯率，也沒有歷史紀錄可參考，請手動輸入今日匯率。',
      } satisfies FxResult
    },
  }),
)
