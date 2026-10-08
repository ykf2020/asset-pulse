import { Delete, LockKeyhole } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/app/auth'
import { Notice } from '@/components/ui/Feedback'
import { api, ApiError, OfflineError } from '@/lib/api'
import { cn } from '@/lib/cn'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const
const MAX_LENGTH = 12

export function Unlock() {
  const { unlock } = useAuth()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    void api
      .checkServer()
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(null))
  }, [])

  const submit = useCallback(
    async (value: string) => {
      setBusy(true)
      setError(null)
      try {
        await unlock(value)
      } catch (err) {
        setPin('')
        if (err instanceof OfflineError) setError('目前沒有網路，無法解鎖')
        else if (err instanceof ApiError) setError(err.message)
        else setError('解鎖失敗，請再試一次')
      } finally {
        setBusy(false)
      }
    },
    [unlock],
  )

  const press = (key: string) => {
    if (busy) return
    setError(null)
    if (key === 'del') {
      setPin((p) => p.slice(0, -1))
      return
    }
    setPin((p) => (p.length >= MAX_LENGTH ? p : p + key))
  }

  // 實體鍵盤（桌機開發時方便）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return
      if (/^[0-9]$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') press('del')
      else if (e.key === 'Enter' && pin.length >= 4) void submit(pin)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-between px-6 pt-16 pb-10 safe-top safe-bottom">
      <div className="flex flex-col items-center gap-6">
        <div className="flex size-16 items-center justify-center rounded-3xl bg-sunken ring-1 ring-hairline">
          <LockKeyhole className="size-7 text-brand" aria-hidden />
        </div>

        <div className="text-center">
          <h1 className="text-xl font-semibold">資產脈動</h1>
          <p className="mt-1 text-sm text-ink-muted">輸入 PIN 解鎖</p>
        </div>

        <div className="flex h-6 items-center gap-3" role="status" aria-label={`已輸入 ${pin.length} 碼`}>
          {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'size-3 rounded-full transition-colors',
                i < pin.length ? 'bg-brand' : 'bg-axis',
              )}
            />
          ))}
        </div>

        <div className="min-h-12 w-full">
          {error && <Notice tone="error">{error}</Notice>}
          {!error && configured === false && (
            <Notice tone="warning" title="伺服器尚未設定完成">
              請先在 Vercel（或 .env.local）填好 Google Sheet 與 PIN 的環境變數。
            </Notice>
          )}
        </div>
      </div>

      <div className="mt-8">
        <div className="grid grid-cols-3 gap-3">
          {KEYS.map((key, index) =>
            key === '' ? (
              <span key={index} />
            ) : (
              <button
                key={index}
                type="button"
                onClick={() => press(key)}
                aria-label={key === 'del' ? '刪除' : key}
                className={cn(
                  'flex h-16 items-center justify-center rounded-2xl text-2xl font-medium',
                  'bg-surface text-ink ring-1 ring-hairline active:scale-[0.97] active:bg-sunken',
                  'transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                )}
              >
                {key === 'del' ? <Delete className="size-6" aria-hidden /> : key}
              </button>
            ),
          )}
        </div>

        <button
          type="button"
          disabled={pin.length < 4 || busy}
          onClick={() => void submit(pin)}
          className={cn(
            'mt-4 h-14 w-full rounded-2xl bg-brand text-lg font-medium text-brand-ink',
            'transition-opacity disabled:opacity-40',
          )}
        >
          {busy ? '解鎖中…' : '解鎖'}
        </button>
      </div>
    </main>
  )
}
