import { requireAuthAll } from './_lib/auth.js'
import { HttpError, jsonBody, route } from './_lib/http.js'
import {
  accountsOf,
  appendToTable,
  loadWorkspace,
  newId,
  nowIso,
  updateInTable,
  updateManyInTable,
  type Workspace,
} from './_lib/store.js'
import { reviewInputSchema, type Snapshot } from '../shared/model.js'
import {
  buildReview,
  mergeReview,
  ReviewBuildError,
  type BuiltReview,
} from '../shared/review.js'
import { dataOf, type Located } from '../shared/sheets-schema.js'

async function persistNew(ws: Workspace, built: BuiltReview): Promise<void> {
  // 先寫明細再寫彙總：萬一中途失敗，Reviews 不會出現一筆沒有明細的孤兒列
  await appendToTable(ws.snapshots, built.snapshots)
  await appendToTable(ws.reviews, [built.review])
}

export default route(
  requireAuthAll({
    /**
     * 送出一次盤點。
     *
     * 同一天已經有紀錄時**併入那一筆**，而不是另外開一筆或擋下來。這是真實
     * 會發生的流程：盤點完才想起漏了一個帳戶，補建之後再跑一次、只填新的那個。
     *
     * 併入也讓這支端點是冪等的 —— 離線佇列重送同樣的內容不會寫出第二筆。
     */
    POST: async (req) => {
      const input = reviewInputSchema.parse(jsonBody(req))
      const ws = await loadWorkspace()
      const accounts = accountsOf(ws.accounts)
      const snapshots = dataOf(ws.snapshots)

      const sameDay = ws.reviews.records.find((r) => r.data.date === input.date)

      try {
        if (sameDay) {
          const merged = mergeReview(input, sameDay.data, accounts, snapshots, {
            newSnapshotId: newId.snapshot,
            createdAt: nowIso(),
          })

          const byId = new Map(merged.snapshots.map((s) => [s.id, s]))
          const updates: Located<Snapshot>[] = ws.snapshots.records
            .filter((r) => merged.changedIds.has(r.data.id))
            .map((r) => ({ rowNumber: r.rowNumber, data: byId.get(r.data.id)! }))

          if (updates.length) await updateManyInTable(ws.snapshots, updates)
          if (merged.inserted.length) await appendToTable(ws.snapshots, merged.inserted)
          await updateInTable(ws.reviews, sameDay.rowNumber, merged.review)

          return {
            review: merged.review,
            snapshots: merged.snapshots,
            merged: true,
            addedAccounts: merged.addedAccounts,
            updatedCount: updates.length,
            carriedForward: [],
          }
        }

        const built = buildReview(input, accounts, snapshots, {
          reviewId: newId.review(),
          newSnapshotId: newId.snapshot,
          createdAt: nowIso(),
        })
        await persistNew(ws, built)

        return {
          review: built.review,
          snapshots: built.snapshots,
          merged: false,
          addedAccounts: [],
          updatedCount: 0,
          carriedForward: built.carriedForward,
        }
      } catch (error) {
        if (error instanceof ReviewBuildError) throw new HttpError(error.message, 400)
        throw error
      }
    },
  }),
)
