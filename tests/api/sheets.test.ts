import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('google-auth-library', () => ({
  JWT: class {
    async getAccessToken() {
      return { token: 'fake-access-token' }
    }
  },
}))

const { batchGetValues, getValues } = await import('../../api/_lib/sheets.js')

const originalEnv = { ...process.env }

/** Google 對「範圍裡的分頁不存在」的實際回應 */
const MISSING_RANGE_BODY = JSON.stringify({
  error: {
    code: 400,
    message: "Unable to parse range: 'Accounts'!A:ZZ",
    status: 'INVALID_ARGUMENT',
  },
})

function json(body: unknown, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

interface Call {
  url: string
  method: string
}

/**
 * @param existingTabs 這份試算表實際有哪些分頁
 */
function stubSheets(existingTabs: string[], data: Record<string, unknown[][]> = {}) {
  const calls: Call[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = decodeURIComponent(String(input))
      calls.push({ url, method: init?.method ?? 'GET' })

      // 分頁清單
      if (url.includes('fields=sheets.properties')) {
        return json({
          sheets: existingTabs.map((title, i) => ({ properties: { sheetId: i, title } })),
        })
      }

      // 取值：範圍裡只要有一個分頁不存在，Google 就讓整個請求失敗
      const requested = [...url.matchAll(/ranges='([^']+)'/g)].map((m) => m[1]!)
      const single = url.match(/\/values\/'([^']+)'/)?.[1]
      const titles = requested.length > 0 ? requested : single ? [single] : []

      const missing = titles.filter((t) => !existingTabs.includes(t))
      if (missing.length > 0) return json(MISSING_RANGE_BODY, 400)

      if (single) return json({ values: data[single] ?? [] })
      return json({ valueRanges: titles.map((t) => ({ range: t, values: data[t] ?? [] })) })
    }),
  )

  return calls
}

beforeEach(() => {
  process.env.SHEET_ID = 'test-sheet'
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'x@y.iam.gserviceaccount.com'
  process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.unstubAllGlobals()
})

const ALL_TABS = ['Accounts', 'Snapshots', 'Reviews', 'Settings']

describe('batchGetValues', () => {
  it('分頁齊全時只打一次 API', async () => {
    const calls = stubSheets(ALL_TABS, { Accounts: [['id', 'name'], ['acc_1', '玉山']] })

    const result = await batchGetValues(ALL_TABS)

    expect(calls).toHaveLength(1)
    expect(result.Accounts).toEqual([['id', 'name'], ['acc_1', '玉山']])
    expect(result.Settings).toEqual([])
  })

  /**
   * 這是部署後實際踩到的狀況：使用者剛開一份空白試算表，四個分頁都還沒建立，
   * /api/data 直接回 400「Unable to parse range」—— 連「幫我建立分頁」的
   * 按鈕都還沒機會出現。
   */
  it('分頁都還沒建立時回空資料，而不是整個請求失敗', async () => {
    const calls = stubSheets(['工作表1'])

    const result = await batchGetValues(ALL_TABS)

    expect(result).toEqual({ Accounts: [], Snapshots: [], Reviews: [], Settings: [] })
    // 第一次嘗試失敗 → 問分頁清單 → 沒有任何需要的分頁，所以不再取值
    expect(calls.map((c) => c.url.includes('fields=sheets.properties'))).toEqual([false, true])
  })

  it('只建了一部分分頁時，existing 的照樣讀得到', async () => {
    stubSheets(['Accounts', 'Settings'], {
      Accounts: [['id'], ['acc_1']],
      Settings: [['key', 'value'], ['stale_days', '10']],
    })

    const result = await batchGetValues(ALL_TABS)

    expect(result.Accounts).toEqual([['id'], ['acc_1']])
    expect(result.Settings).toEqual([['key', 'value'], ['stale_days', '10']])
    expect(result.Snapshots).toEqual([])
    expect(result.Reviews).toEqual([])
  })

  it('不會把其他錯誤也當成「分頁不存在」吞掉', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: '爆炸了' } }, 500)))

    await expect(batchGetValues(ALL_TABS)).rejects.toThrow(/500/)
  })

  it('403 給的是「要分享給 service account」而不是原始錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 403)))

    await expect(batchGetValues(ALL_TABS)).rejects.toThrow(/編輯者/)
  })

  it('404 指向 SHEET_ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 404)))

    await expect(batchGetValues(ALL_TABS)).rejects.toThrow(/SHEET_ID/)
  })
})

describe('getValues', () => {
  it('分頁不存在時回空陣列', async () => {
    stubSheets(['工作表1'])
    expect(await getValues('Accounts')).toEqual([])
  })

  it('分頁存在時回內容', async () => {
    stubSheets(['Accounts'], { Accounts: [['id'], ['acc_1']] })
    expect(await getValues('Accounts')).toEqual([['id'], ['acc_1']])
  })
})
