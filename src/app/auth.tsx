import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, tokenStore } from '@/lib/api'
import { clearDataCache } from '@/lib/db'

interface AuthValue {
  unlocked: boolean
  unlock: (pin: string) => Promise<void>
  lock: (options?: { wipeCache?: boolean }) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/** token 過期時由 query 層丟出這個事件，讓整個 App 回到 PIN 畫面 */
export const UNAUTHORIZED_EVENT = 'ap:unauthorized'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => tokenStore.get() !== null)

  useEffect(() => {
    const onUnauthorized = () => {
      tokenStore.clear()
      setUnlocked(false)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const unlock = useCallback(async (pin: string) => {
    const { token } = await api.login(pin)
    tokenStore.set(token)
    setUnlocked(true)
  }, [])

  const lock = useCallback(async (options?: { wipeCache?: boolean }) => {
    tokenStore.clear()
    if (options?.wipeCache) await clearDataCache()
    setUnlocked(false)
  }, [])

  const value = useMemo<AuthValue>(() => ({ unlocked, unlock, lock }), [unlocked, unlock, lock])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth 必須在 AuthProvider 內使用')
  return context
}
