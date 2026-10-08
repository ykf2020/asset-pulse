import { requireAuthAll } from './_lib/auth'
import { route } from './_lib/http'
import { accountMap, loadWorkspace, updateManyInTable } from './_lib/store'
import { round2, sumTotals } from '../shared/money'
import type { Review, Snapshot } from '../shared/model'
import type { Located } from '../shared/sheets-schema'

/**
 * POST /api/recalc
 *
 * 把 Google Sheet 上的衍生欄位重新算一次：
 *   Snapshots.amount_twd = amount × fx_rate
 *   Reviews.total_* / net_worth_twd = 該次所有明細加總
 *
 * App 本身一律從 `amount` 現算，所以不跑這支也不會看到錯的數字；這支是為了讓
 * 「直接打開 Google Sheet 看」的時候欄位也是一致的 —— 例如你手動改了某筆金額之後。
 */
export default route(
  requireAuthAll({
    POST: async () => {
      const ws = await loadWorkspace()
      const accounts = accountMap(ws.accounts)

      const snapshotUpdates: Located<Snapshot>[] = []
      const fixedSnapshots = new Map<string, Snapshot>()

      for (const { data, rowNumber } of ws.snapshots.records) {
        const account = accounts.get(data.account_id)
        const currency = account?.currency ?? data.currency
        const fxRate = currency === 'TWD' ? 1 : data.fx_rate > 0 ? data.fx_rate : 1
        const amountTwd = round2(data.amount * fxRate)

        const fixed: Snapshot = { ...data, currency, fx_rate: fxRate, amount_twd: amountTwd }
        fixedSnapshots.set(data.id, fixed)

        if (
          fixed.amount_twd !== data.amount_twd ||
          fixed.fx_rate !== data.fx_rate ||
          fixed.currency !== data.currency
        ) {
          snapshotUpdates.push({ rowNumber, data: fixed })
        }
      }

      const byReview = new Map<string, Snapshot[]>()
      for (const snapshot of fixedSnapshots.values()) {
        const list = byReview.get(snapshot.review_id)
        if (list) list.push(snapshot)
        else byReview.set(snapshot.review_id, [snapshot])
      }

      const reviewUpdates: Located<Review>[] = []
      for (const { data, rowNumber } of ws.reviews.records) {
        const mine = byReview.get(data.id) ?? []
        const totals = sumTotals(
          mine.map((s) => ({
            isLiability: accounts.get(s.account_id)?.is_liability ?? false,
            amountTwd: s.amount_twd,
          })),
        )
        const fixed: Review = {
          ...data,
          total_assets_twd: totals.assets,
          total_liabilities_twd: totals.liabilities,
          net_worth_twd: totals.netWorth,
        }
        if (
          fixed.total_assets_twd !== data.total_assets_twd ||
          fixed.total_liabilities_twd !== data.total_liabilities_twd ||
          fixed.net_worth_twd !== data.net_worth_twd
        ) {
          reviewUpdates.push({ rowNumber, data: fixed })
        }
      }

      if (snapshotUpdates.length) await updateManyInTable(ws.snapshots, snapshotUpdates)
      if (reviewUpdates.length) await updateManyInTable(ws.reviews, reviewUpdates)

      return {
        ok: true,
        snapshotsFixed: snapshotUpdates.length,
        reviewsFixed: reviewUpdates.length,
        message:
          snapshotUpdates.length + reviewUpdates.length === 0
            ? 'Google Sheet 的欄位本來就一致，沒有任何變動。'
            : `已更新 ${snapshotUpdates.length} 筆明細、${reviewUpdates.length} 筆盤點彙總。`,
      }
    },
  }),
)
