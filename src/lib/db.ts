import Dexie, { type Table } from 'dexie'
import type { ReviewInput } from '@shared/model'
import type { DataPayload } from './api'

interface CacheEntry {
  key: string
  value: unknown
  savedAt: string
}

export interface PendingReview {
  /** 本地佇列 id，也拿來當送出時的識別 */
  id: string
  payload: ReviewInput
  queuedAt: string
  attempts: number
  lastError?: string
}

class AssetPulseDb extends Dexie {
  cache!: Table<CacheEntry, string>
  pending!: Table<PendingReview, string>

  constructor() {
    super('asset-pulse')
    this.version(1).stores({
      cache: 'key',
      pending: 'id, queuedAt',
    })
  }
}

export const db = new AssetPulseDb()

const DATA_KEY = 'data'

/* ------------------------------------------------------------------ */
/* 離線快取                                                            */
/* ------------------------------------------------------------------ */

export async function saveDataCache(payload: DataPayload): Promise<void> {
  try {
    await db.cache.put({ key: DATA_KEY, value: payload, savedAt: new Date().toISOString() })
  } catch {
    /* 存不進去（配額、私密瀏覽）就放棄快取，不影響主流程 */
  }
}

export async function loadDataCache(): Promise<{ payload: DataPayload; savedAt: string } | null> {
  try {
    const entry = await db.cache.get(DATA_KEY)
    if (!entry) return null
    return { payload: entry.value as DataPayload, savedAt: entry.savedAt }
  } catch {
    return null
  }
}

export async function clearDataCache(): Promise<void> {
  try {
    await db.cache.clear()
    await db.pending.clear()
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* 待送出佇列                                                           */
/* ------------------------------------------------------------------ */

export async function enqueueReview(payload: ReviewInput): Promise<PendingReview> {
  const item: PendingReview = {
    id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  }
  await db.pending.put(item)
  return item
}

export async function listPending(): Promise<PendingReview[]> {
  try {
    return await db.pending.orderBy('queuedAt').toArray()
  } catch {
    return []
  }
}

export async function markPendingFailed(id: string, error: string): Promise<void> {
  const item = await db.pending.get(id)
  if (!item) return
  await db.pending.put({ ...item, attempts: item.attempts + 1, lastError: error })
}

export async function removePending(id: string): Promise<void> {
  await db.pending.delete(id)
}
