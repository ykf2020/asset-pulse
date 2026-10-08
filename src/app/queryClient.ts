import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError, OfflineError } from '@/lib/api'
import { UNAUTHORIZED_EVENT } from './auth'

function handleError(error: unknown) {
  if (error instanceof ApiError && error.isAuthError) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleError }),
  mutationCache: new MutationCache({ onError: handleError }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // 離線或認證失敗重試沒有意義
        if (error instanceof OfflineError) return false
        if (error instanceof ApiError && error.status < 500) return false
        return failureCount < 2
      },
    },
    mutations: { retry: false },
  },
})

export const dataQueryKey = ['data'] as const
