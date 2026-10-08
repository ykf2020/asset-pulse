import { requireAuthAll } from './_lib/auth'
import { route } from './_lib/http'
import {
  addSheet,
  formatHeader,
  getSheetMeta,
  getValues,
  renameSheet,
  writeHeaderRow,
} from './_lib/sheets'
import { SHEETS, type SheetKey } from '../shared/sheets-schema'
import { DEFAULT_SETTINGS } from '../shared/model'
import { appendRows } from './_lib/sheets'

/** 全新 Google Sheet 的預設分頁名稱，可以直接拿來改名而不是另外新增 */
const BLANK_DEFAULT_TITLES = ['Sheet1', '工作表1', 'Sheet 1']

/**
 * POST /api/bootstrap
 * 把一份空白 Google Sheet 準備成 Asset Pulse 的資料庫。
 * 可以重複執行 —— 已存在的分頁與資料都不會被動到。
 */
export default route(
  requireAuthAll({
    POST: async () => {
      const keys = Object.keys(SHEETS) as SheetKey[]
      const created: string[] = []
      const headersWritten: string[] = []
      const untouched: string[] = []

      let meta = await getSheetMeta()

      for (const key of keys) {
        const { title, headers } = SHEETS[key]
        let existing = meta.find((s) => s.title === title)

        if (!existing) {
          // 全新的 Sheet 只有一個空白預設分頁 → 直接改名，不留下孤兒分頁
          const blank = meta.find(
            (s) => BLANK_DEFAULT_TITLES.includes(s.title) && !keys.some((k) => SHEETS[k].title === s.title),
          )
          const blankIsEmpty = blank ? (await getValues(blank.title)).length === 0 : false

          if (blank && blankIsEmpty) {
            await renameSheet(blank.sheetId, title)
            existing = { sheetId: blank.sheetId, title }
            meta = meta.map((s) => (s.sheetId === blank.sheetId ? existing! : s))
          } else {
            await addSheet(title)
            meta = await getSheetMeta()
            existing = meta.find((s) => s.title === title)
          }
          created.push(title)
        }

        if (!existing) continue

        const current = await getValues(title)
        if (current.length === 0) {
          await writeHeaderRow(title, headers)
          await formatHeader(existing.sheetId, headers.length)
          headersWritten.push(title)
        } else {
          untouched.push(title)
        }
      }

      // 設定預設值（只有在 Settings 完全空的時候）
      const settingsRows = await getValues(SHEETS.settings.title)
      if (settingsRows.length <= 1) {
        await appendRows(
          SHEETS.settings.title,
          Object.entries(DEFAULT_SETTINGS).map(([k, v]) => [k, String(v)]),
        )
      }

      return {
        ok: true,
        created,
        headersWritten,
        untouched,
        message:
          created.length || headersWritten.length
            ? `已準備好分頁：${[...new Set([...created, ...headersWritten])].join('、')}`
            : 'Google Sheet 已經是最新狀態，沒有任何變動。',
      }
    },
  }),
)
