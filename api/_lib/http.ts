import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ZodError } from 'zod'
import { HttpError, SheetsError } from './errors.js'

export { HttpError }

export type Handler = (req: VercelRequest, res: VercelResponse) => Promise<unknown>

/** 統一錯誤處理：所有錯誤都回 `{ error: '中文訊息' }`，前端直接拿去顯示 */
export function route(handlers: Partial<Record<string, Handler>>): Handler {
  return async (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase()

    if (method === 'OPTIONS') {
      res.status(204).end()
      return
    }

    const handler = handlers[method]
    if (!handler) {
      res.setHeader('Allow', Object.keys(handlers).join(', '))
      res.status(405).json({ error: `不支援 ${method} 方法` })
      return
    }

    try {
      const result = await handler(req, res)
      if (!res.writableEnded && result !== undefined) {
        res.status(200).json(result)
      }
    } catch (err) {
      const { status, message } = describeError(err)
      if (status >= 500) console.error('[api]', err)
      if (!res.writableEnded) res.status(status).json({ error: message })
    }
  }
}

function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof ZodError) {
    const first = err.issues[0]
    const where = first?.path.length ? `${first.path.join('.')}：` : ''
    return { status: 400, message: `${where}${first?.message ?? '輸入格式不正確'}` }
  }
  if (err instanceof HttpError) return { status: err.status, message: err.message }
  if (err instanceof SheetsError) return { status: err.status, message: err.message }
  return { status: 500, message: (err as Error)?.message || '伺服器發生未預期的錯誤' }
}

/** 讀取 JSON body（Vercel 已幫忙 parse，但手動呼叫或 text/plain 時可能是字串） */
export function jsonBody(req: VercelRequest): unknown {
  const body = req.body
  if (typeof body === 'string') {
    if (body.trim() === '') return {}
    try {
      return JSON.parse(body)
    } catch {
      throw new HttpError('請求內容不是合法的 JSON')
    }
  }
  return body ?? {}
}

export function queryParam(req: VercelRequest, key: string): string | undefined {
  const v = req.query[key]
  return Array.isArray(v) ? v[0] : v
}
