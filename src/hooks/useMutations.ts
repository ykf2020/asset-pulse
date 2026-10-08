import { useMutation, useQueryClient } from '@tanstack/react-query'
import { dataQueryKey } from '@/app/queryClient'
import { api, OfflineError } from '@/lib/api'
import { enqueueReview } from '@/lib/db'
import type { AccountInput, AccountPatch, AppSettings, ReviewInput } from '@shared/model'

function useInvalidateData() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: dataQueryKey })
}

export function useCreateAccount() {
  const invalidate = useInvalidateData()
  return useMutation({
    mutationFn: (input: AccountInput) => api.createAccount(input),
    onSuccess: invalidate,
  })
}

export function useUpdateAccount() {
  const invalidate = useInvalidateData()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AccountPatch }) =>
      api.updateAccount(id, patch),
    onSuccess: invalidate,
  })
}

export function useRemoveAccount() {
  const invalidate = useInvalidateData()
  return useMutation({
    mutationFn: (id: string) => api.removeAccount(id),
    onSuccess: invalidate,
  })
}

export function useReorderAccounts() {
  const invalidate = useInvalidateData()
  return useMutation({
    mutationFn: (order: string[]) => api.reorderAccounts(order),
    onSuccess: invalidate,
  })
}

export type SubmitReviewResult =
  | { status: 'sent'; carriedForward: string[] }
  | { status: 'queued' }

/**
 * 送出盤點。沒網路時不當成錯誤 —— 收進 IndexedDB 佇列，連線恢復時自動補送。
 * 使用者在火車上也能把盤點做完。
 */
export function useSubmitReview() {
  const invalidate = useInvalidateData()
  return useMutation<SubmitReviewResult, Error, ReviewInput & { force?: boolean }>({
    mutationFn: async (input) => {
      try {
        const result = await api.createReview(input)
        return { status: 'sent', carriedForward: result.carriedForward }
      } catch (error) {
        if (error instanceof OfflineError) {
          const { force: _force, ...payload } = input
          await enqueueReview(payload)
          return { status: 'queued' }
        }
        throw error
      }
    },
    onSuccess: (result) => {
      if (result.status === 'sent') void invalidate()
    },
  })
}

export function useUpdateReview() {
  const invalidate = useInvalidateData()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Parameters<typeof api.updateReview>[1]
    }) => api.updateReview(id, patch),
    onSuccess: invalidate,
  })
}

export function useDeleteReview() {
  const invalidate = useInvalidateData()
  return useMutation({
    mutationFn: (id: string) => api.deleteReview(id),
    onSuccess: invalidate,
  })
}

export function useUpdateSettings() {
  const invalidate = useInvalidateData()
  return useMutation({
    mutationFn: (patch: Partial<AppSettings>) => api.updateSettings(patch),
    onSuccess: invalidate,
  })
}

export function useBootstrap() {
  const invalidate = useInvalidateData()
  return useMutation({ mutationFn: () => api.bootstrap(), onSuccess: invalidate })
}

export function useRecalc() {
  const invalidate = useInvalidateData()
  return useMutation({ mutationFn: () => api.recalc(), onSuccess: invalidate })
}
