import type { VercelRequest } from '@vercel/node'
import { z } from 'zod'
import { requireAuthAll } from './_lib/auth.js'
import { HttpError, jsonBody, queryParam, route } from './_lib/http.js'
import { deleteRows, getSheetMeta } from './_lib/sheets.js'
import {
  accountsOf,
  appendToTable,
  loadTables,
  newId,
  nowIso,
  requireById,
  updateInTable,
  updateManyInTable,
} from './_lib/store.js'
import {
  accountInputSchema,
  accountPatchSchema,
  LIABILITY_TYPES,
  type Account,
} from '../shared/model.js'
import { dataOf, SHEETS } from '../shared/sheets-schema.js'

const reorderSchema = z.object({
  order: z.array(z.string().min(1)).min(1),
})

function requireId(req: VercelRequest): string {
  const id = queryParam(req, 'id')
  if (!id) throw new HttpError('缺少 id 參數')
  return id
}

export default route(
  requireAuthAll({
    /** 建立帳戶 */
    POST: async (req) => {
      const input = accountInputSchema.parse(jsonBody(req))
      const { accounts } = await loadTables(['accounts'])

      const existing = accountsOf(accounts)
      if (existing.some((a) => a.status === 'active' && a.name === input.name)) {
        throw new HttpError(`已經有一個叫「${input.name}」的帳戶了`, 409)
      }

      const maxOrder = existing.reduce((m, a) => Math.max(m, a.sort_order), 0)

      const account: Account = {
        id: newId.account(),
        name: input.name,
        type: input.type,
        currency: input.currency,
        institution: input.institution,
        is_liability: input.is_liability,
        sort_order: input.sort_order ?? maxOrder + 1,
        status: 'active',
        note: input.note,
        created_at: nowIso(),
      }

      await appendToTable(accounts, [account])
      return { account }
    },

    /** 更新單一帳戶 */
    PATCH: async (req) => {
      const id = requireId(req)
      const patch = accountPatchSchema.parse(jsonBody(req))
      const { accounts } = await loadTables(['accounts'])
      const found = requireById(accounts, id, '帳戶')

      // 幣別一旦有歷史資料就不該亂改，否則舊的 amount 會被用錯匯率詮釋
      if (patch.currency && patch.currency !== found.data.currency) {
        const { snapshots } = await loadTables(['snapshots'])
        const hasHistory = dataOf(snapshots).some((s) => s.account_id === id)
        if (hasHistory) {
          throw new HttpError(
            '這個帳戶已經有盤點紀錄，不能更換計價幣別。請改為封存它、另外建立新帳戶。',
            409,
          )
        }
      }

      const updated: Account = {
        ...found.data,
        ...patch,
        // 類型改成貸款時，若呼叫端沒明講，順手把負債旗標帶對
        is_liability:
          patch.is_liability ??
          (patch.type ? LIABILITY_TYPES.includes(patch.type) : found.data.is_liability),
      }

      await updateInTable(accounts, found.rowNumber, updated)
      return { account: updated }
    },

    /** 調整帳戶排序（盤點時的順序） */
    PUT: async (req) => {
      const { order } = reorderSchema.parse(jsonBody(req))
      const { accounts } = await loadTables(['accounts'])

      const updates = order
        .map((id, index) => {
          const found = accounts.records.find((r) => r.data.id === id)
          if (!found) return null
          return {
            rowNumber: found.rowNumber,
            data: { ...found.data, sort_order: index + 1 },
          }
        })
        .filter((u): u is NonNullable<typeof u> => u !== null)

      await updateManyInTable(accounts, updates)
      return { ok: true, updated: updates.length }
    },

    /**
     * 已經有盤點紀錄 → 封存（保留歷史）；完全沒有紀錄 → 直接刪掉該列（打錯字時好用）
     */
    DELETE: async (req) => {
      const id = requireId(req)
      const { accounts, snapshots } = await loadTables(['accounts', 'snapshots'])
      const found = requireById(accounts, id, '帳戶')

      const hasHistory = dataOf(snapshots).some((s) => s.account_id === id)

      if (hasHistory) {
        const archived: Account = { ...found.data, status: 'archived' }
        await updateInTable(accounts, found.rowNumber, archived)
        return { account: archived, action: 'archived' as const }
      }

      const meta = await getSheetMeta()
      const sheet = meta.find((s) => s.title === SHEETS.accounts.title)
      if (!sheet) throw new HttpError('找不到 Accounts 分頁', 500)

      await deleteRows(sheet.sheetId, [found.rowNumber])
      return { id, action: 'deleted' as const }
    },
  }),
)
