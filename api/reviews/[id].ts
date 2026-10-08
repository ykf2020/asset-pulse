import type { VercelRequest } from '@vercel/node'
import { z } from 'zod'
import { requireAuthAll } from '../_lib/auth.js'
import { HttpError, jsonBody, queryParam, route } from '../_lib/http.js'
import { deleteRows, getSheetMeta } from '../_lib/sheets.js'
import {
  accountMap,
  appendToTable,
  loadWorkspace,
  newId,
  nowIso,
  requireById,
  updateInTable,
  updateManyInTable,
} from '../_lib/store.js'
import { isoDate, reviewEntryInputSchema, type Review, type Snapshot } from '../../shared/model.js'
import { dataOf, SHEETS, type Located } from '../../shared/sheets-schema.js'
import { fxRateFor, sumTotals, toTwd } from '../../shared/money.js'

const patchSchema = z.object({
  date: isoDate.optional(),
  usd_twd_rate: z.number().positive().optional(),
  note: z.string().trim().max(200).optional(),
  /** 只需要送有改動的帳戶 */
  entries: z.array(reviewEntryInputSchema).optional(),
})

function requireReviewId(req: VercelRequest): string {
  const id = queryParam(req, 'id')
  if (!id) throw new HttpError('缺少盤點 id')
  return id
}

export default route(
  requireAuthAll({
    /** 單次盤點的明細 */
    GET: async (req) => {
      const id = requireReviewId(req)
      const ws = await loadWorkspace()
      const review = requireById(ws.reviews, id, '盤點紀錄').data
      const snapshots = dataOf(ws.snapshots).filter((s) => s.review_id === id)
      return { review, snapshots }
    },

    /** 修正已送出的盤點：改日期、改匯率、改某些帳戶的金額 */
    PATCH: async (req) => {
      const id = requireReviewId(req)
      const patch = patchSchema.parse(jsonBody(req))
      const ws = await loadWorkspace()

      const foundReview = requireById(ws.reviews, id, '盤點紀錄')
      const accounts = accountMap(ws.accounts)

      const date = patch.date ?? foundReview.data.date
      const rate = patch.usd_twd_rate ?? foundReview.data.usd_twd_rate

      if (patch.date && patch.date !== foundReview.data.date) {
        const clash = dataOf(ws.reviews).find((r) => r.date === patch.date && r.id !== id)
        if (clash) throw new HttpError(`${patch.date} 已經有另一筆盤點紀錄了`, 409)
      }

      const mine = ws.snapshots.records.filter((r) => r.data.review_id === id)
      const amountByAccount = new Map((patch.entries ?? []).map((e) => [e.account_id, e]))

      const snapshotUpdates: Located<Snapshot>[] = []
      const snapshotInserts: Snapshot[] = []
      const touchedAccounts = new Set<string>()

      // 既有明細：套用新金額 / 新日期 / 新匯率
      for (const record of mine) {
        const account = accounts.get(record.data.account_id)
        const entry = amountByAccount.get(record.data.account_id)
        const currency = account?.currency ?? record.data.currency
        const amount = entry ? entry.amount : record.data.amount

        snapshotUpdates.push({
          rowNumber: record.rowNumber,
          data: {
            ...record.data,
            date,
            amount,
            currency,
            fx_rate: fxRateFor(currency, rate),
            amount_twd: toTwd(amount, currency, rate),
            note: entry ? entry.note : record.data.note,
          },
        })
        touchedAccounts.add(record.data.account_id)
      }

      // 這次新加入的帳戶（原本那次盤點沒有它）
      for (const entry of patch.entries ?? []) {
        if (touchedAccounts.has(entry.account_id)) continue
        const account = accounts.get(entry.account_id)
        if (!account) throw new HttpError(`帳戶 ${entry.account_id} 不存在`, 400)

        snapshotInserts.push({
          id: newId.snapshot(),
          review_id: id,
          date,
          account_id: account.id,
          amount: entry.amount,
          currency: account.currency,
          fx_rate: fxRateFor(account.currency, rate),
          amount_twd: toTwd(entry.amount, account.currency, rate),
          note: entry.note,
          created_at: nowIso(),
        })
      }

      const finalSnapshots = [...snapshotUpdates.map((u) => u.data), ...snapshotInserts]
      const totals = sumTotals(
        finalSnapshots.map((s) => ({
          isLiability: accounts.get(s.account_id)?.is_liability ?? false,
          amountTwd: s.amount_twd,
        })),
      )

      const updatedReview: Review = {
        ...foundReview.data,
        date,
        usd_twd_rate: rate,
        total_assets_twd: totals.assets,
        total_liabilities_twd: totals.liabilities,
        net_worth_twd: totals.netWorth,
        note: patch.note ?? foundReview.data.note,
      }

      if (snapshotUpdates.length) await updateManyInTable(ws.snapshots, snapshotUpdates)
      if (snapshotInserts.length) await appendToTable(ws.snapshots, snapshotInserts)
      await updateInTable(ws.reviews, foundReview.rowNumber, updatedReview)

      return { review: updatedReview, snapshots: finalSnapshots }
    },

    /** 刪除整次盤點（連同它的所有明細） */
    DELETE: async (req) => {
      const id = requireReviewId(req)
      const ws = await loadWorkspace()
      const foundReview = requireById(ws.reviews, id, '盤點紀錄')

      const meta = await getSheetMeta()
      const reviewsSheet = meta.find((s) => s.title === SHEETS.reviews.title)
      const snapshotsSheet = meta.find((s) => s.title === SHEETS.snapshots.title)
      if (!reviewsSheet || !snapshotsSheet) {
        throw new HttpError('找不到 Reviews / Snapshots 分頁', 500)
      }

      const snapshotRows = ws.snapshots.records
        .filter((r) => r.data.review_id === id)
        .map((r) => r.rowNumber)

      await deleteRows(snapshotsSheet.sheetId, snapshotRows)
      await deleteRows(reviewsSheet.sheetId, [foundReview.rowNumber])

      return { ok: true, deletedSnapshots: snapshotRows.length }
    },
  }),
)
