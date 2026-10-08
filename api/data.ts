import { requireAuthAll } from './_lib/auth'
import { route } from './_lib/http'
import { accountsOf, loadWorkspace, readSettings } from './_lib/store'
import { spreadsheetId } from './_lib/sheets'
import { dataOf, SHEETS, type SheetKey } from '../shared/sheets-schema'

/**
 * GET /api/data — 一次回傳整個資料集。
 *
 * 個人用途的量級很小（每週一次盤點，十年也才幾千列），與其拆成多個端點各自
 * 分頁，不如一次全拿：前端算所有衍生數字都不用再往返，離線快取也只要存這一包。
 */
export default route(
  requireAuthAll({
    GET: async () => {
      const ws = await loadWorkspace()

      const warnings: string[] = []
      for (const key of Object.keys(SHEETS) as SheetKey[]) {
        for (const s of ws[key].skipped) {
          warnings.push(`「${SHEETS[key].title}」第 ${s.rowNumber} 列讀不懂，已略過（${s.reason}）`)
        }
      }

      const needsBootstrap = ws.accounts.headers.length === 0

      return {
        needsBootstrap,
        sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId()}/edit`,
        accounts: accountsOf(ws.accounts),
        snapshots: dataOf(ws.snapshots),
        reviews: dataOf(ws.reviews).sort((a, b) => a.date.localeCompare(b.date)),
        settings: readSettings(ws.settings),
        warnings,
        fetchedAt: new Date().toISOString(),
      }
    },
  }),
)
