import type {
  Account,
  AccountInput,
  AccountPatch,
  AppSettings,
  Review,
  ReviewInput,
  Snapshot,
} from '@shared/model'

const TOKEN_KEY = 'ap.token'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
  get isAuthError(): boolean {
    return this.status === 401
  }
  get isConflict(): boolean {
    return this.status === 409
  }
}

/** 網路斷線 / 伺服器連不上，與「伺服器回錯誤」要分開處理（離線佇列只看這個） */
export class OfflineError extends Error {
  constructor() {
    super('目前沒有網路連線')
    this.name = 'OfflineError'
  }
}

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set: (token: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      /* 無痕模式等情境下寫不進去，就當作沒有持久化 */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
  },
}

interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, string | undefined>
  /** 預設帶上 token；登入端點不需要 */
  auth?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true } = options

  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = tokenStore.get()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new OfflineError()
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  let payload: unknown = undefined
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = undefined
    }
  }

  if (!res.ok) {
    const message =
      (payload as { error?: string } | undefined)?.error ??
      `請求失敗（${res.status}）`
    if (res.status === 401) tokenStore.clear()
    throw new ApiError(message, res.status)
  }

  return payload as T
}

/* ------------------------------------------------------------------ */
/* 端點                                                                 */
/* ------------------------------------------------------------------ */

export interface DataPayload {
  needsBootstrap: boolean
  sheetUrl: string
  accounts: Account[]
  snapshots: Snapshot[]
  reviews: Review[]
  settings: AppSettings
  warnings: string[]
  fetchedAt: string
}

export interface ServerHealth {
  configured: boolean
  checks: {
    pin: boolean
    sheetId: boolean
    serviceAccountEmail: boolean
    privateKey: boolean
  }
  /** 環境變數格式有問題時的具體說明（不含任何金鑰內容） */
  hint?: string
}

export interface FxResult {
  rate: number
  source: 'live' | 'last_review' | 'fallback'
  asOf: string
  note?: string
}

export const api = {
  checkServer: () => request<ServerHealth>('/api/auth', { auth: false }),

  login: (pin: string) =>
    request<{ token: string; expiresAt: string }>('/api/auth', {
      method: 'POST',
      body: { pin },
      auth: false,
    }),

  bootstrap: () => request<{ ok: true; message: string }>('/api/bootstrap', { method: 'POST' }),

  getData: () => request<DataPayload>('/api/data'),

  getFx: () => request<FxResult>('/api/fx'),

  createAccount: (input: AccountInput) =>
    request<{ account: Account }>('/api/accounts', { method: 'POST', body: input }),

  updateAccount: (id: string, patch: AccountPatch) =>
    request<{ account: Account }>('/api/accounts', {
      method: 'PATCH',
      body: patch,
      query: { id },
    }),

  reorderAccounts: (order: string[]) =>
    request<{ ok: true }>('/api/accounts', { method: 'PUT', body: { order } }),

  removeAccount: (id: string) =>
    request<{ action: 'archived' | 'deleted' }>('/api/accounts', {
      method: 'DELETE',
      query: { id },
    }),

  createReview: (input: ReviewInput & { force?: boolean }) =>
    request<{ review: Review; snapshots: Snapshot[]; carriedForward: string[] }>(
      '/api/reviews',
      { method: 'POST', body: input },
    ),

  updateReview: (
    id: string,
    patch: {
      date?: string
      usd_twd_rate?: number
      note?: string
      entries?: { account_id: string; amount: number; note: string }[]
    },
  ) =>
    request<{ review: Review; snapshots: Snapshot[] }>(`/api/reviews/${id}`, {
      method: 'PATCH',
      body: patch,
    }),

  deleteReview: (id: string) =>
    request<{ ok: true }>(`/api/reviews/${id}`, { method: 'DELETE' }),

  recalc: () =>
    request<{ ok: true; message: string; snapshotsFixed: number; reviewsFixed: number }>(
      '/api/recalc',
      { method: 'POST' },
    ),

  updateSettings: (patch: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/api/settings', { method: 'PATCH', body: patch }),
}
