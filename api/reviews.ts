import { z } from 'zod'
import { requireAuthAll } from './_lib/auth'
import { HttpError, jsonBody, route } from './_lib/http'
import {
  accountsOf,
  appendToTable,
  loadWorkspace,
  newId,
  nowIso,
  type Workspace,
} from './_lib/store'
import { reviewInputSchema } from '../shared/model'
import { buildReview, ReviewBuildError, type BuiltReview } from '../shared/review'
import { dataOf } from '../shared/sheets-schema'

const postSchema = reviewInputSchema.extend({
  /** 同一天已有紀錄時，預設擋下來（也順便讓離線佇列重送不會寫兩次） */
  force: z.boolean().default(false),
})

async function persist(ws: Workspace, built: BuiltReview): Promise<void> {
  // 先寫明細再寫彙總：萬一中途失敗，Reviews 不會出現一筆沒有明細的孤兒列
  await appendToTable(ws.snapshots, built.snapshots)
  await appendToTable(ws.reviews, [built.review])
}

export default route(
  requireAuthAll({
    POST: async (req) => {
      const { force, ...input } = postSchema.parse(jsonBody(req))
      const ws = await loadWorkspace()

      const sameDay = dataOf(ws.reviews).find((r) => r.date === input.date)
      if (sameDay && !force) {
        throw new HttpError(
          `${input.date} 已經有一筆盤點紀錄了。要修改請到「歷史」頁編輯那一筆。`,
          409,
        )
      }

      let built: BuiltReview
      try {
        built = buildReview(input, accountsOf(ws.accounts), dataOf(ws.snapshots), {
          reviewId: newId.review(),
          newSnapshotId: newId.snapshot,
          createdAt: nowIso(),
        })
      } catch (error) {
        if (error instanceof ReviewBuildError) throw new HttpError(error.message, 400)
        throw error
      }

      await persist(ws, built)

      return {
        review: built.review,
        snapshots: built.snapshots,
        carriedForward: built.carriedForward,
      }
    },
  }),
)
