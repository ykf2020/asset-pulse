import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { dataQueryKey } from '@/app/queryClient'
import { api, ApiError, OfflineError, type DataPayload } from '@/lib/api'
import {
  listPending,
  loadDataCache,
  markPendingFailed,
  removePending,
  saveDataCache,
  type PendingReview,
} from '@/lib/db'
import { buildOverview, type Overview } from '@/lib/derive'
import { DEFAULT_SETTINGS } from '@shared/model'

/* ------------------------------------------------------------------ */
/* 主資料                                                               */
/* ------------------------------------------------------------------ */

export function useData() {
  return useQuery({
    queryKey: dataQueryKey,
    queryFn: async () => {
      const payload = await api.getData()
      void saveDataCache(payload)
      return payload
    },
  })
}

/** 衍生出首頁要的所有數字；資料還沒到就回 null */
export function useOverview(): { data: DataPayload | undefined; overview: Overview | null } {
  const { data } = useData()
  const overview = useMemo(
    () => (data ? buildOverview(data, data.settings ?? DEFAULT_SETTINGS) : null),
    [data],
  )
  return { data, overview }
}

/**
 * 開 App 時先把 IndexedDB 的上一份資料塞進 query cache，畫面立刻有東西，
 * 網路回來後再被覆蓋。離線（飛航模式）時就一直是這份。
 */
export function useCacheHydration(enabled: boolean): boolean {
  const queryClient = useQueryClient()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setReady(true)
      return
    }
    let cancelled = false
    void (async () => {
      const cached = await loadDataCache()
      if (cancelled) return
      if (cached && queryClient.getQueryData(dataQueryKey) === undefined) {
        // updatedAt: 0 讓這份資料一進來就算過期 —— 畫面馬上有東西，但仍然會立刻
        // 去抓新的。少了這個參數，staleTime 會讓開 App 的第一分鐘停在舊數字上。
        queryClient.setQueryData(dataQueryKey, cached.payload, { updatedAt: 0 })
      }
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, queryClient])

  return ready
}

/* ------------------------------------------------------------------ */
/* 離線狀態                                                             */
/* ------------------------------------------------------------------ */

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

/* ------------------------------------------------------------------ */
/* 待送出佇列                                                           */
/* ------------------------------------------------------------------ */

export interface SyncState {
  pending: PendingReview[]
  syncing: boolean
  refresh: () => Promise<void>
  flush: () => Promise<void>
  discard: (id: string) => Promise<void>
}

export function useSync(enabled: boolean): SyncState {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<PendingReview[]>([])
  const [syncing, setSyncing] = useState(false)

  const refresh = useCallback(async () => {
    setPending(await listPending())
  }, [])

  const flush = useCallback(
    async () => {
      if (!navigator.onLine) return
      const queue = await listPending()
      if (queue.length === 0) {
        setPending([])
        return
      }

      setSyncing(true)
      let changed = false

      for (const item of queue) {
        try {
          await api.createReview(item.payload)
          await removePending(item.id)
          changed = true
        } catch (error) {
          if (error instanceof OfflineError) break
          const message =
            error instanceof ApiError ? error.message : '送出失敗，稍後會再試一次'
          await markPendingFailed(item.id, message)
          if (error instanceof ApiError && error.status >= 500) break
        }
      }

      setSyncing(false)
      setPending(await listPending())
      if (changed) await queryClient.invalidateQueries({ queryKey: dataQueryKey })
    },
    [queryClient],
  )

  const discard = useCallback(
    async (id: string) => {
      await removePending(id)
      setPending(await listPending())
    },
    [],
  )

  useEffect(() => {
    if (!enabled) return
    void flush()
    const onOnline = () => void flush()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [enabled, flush])

  return { pending, syncing, refresh, flush, discard }
}
