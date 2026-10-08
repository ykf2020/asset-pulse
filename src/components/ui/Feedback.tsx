import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-ink-muted', className)} aria-hidden />
}

export function LoadingBlock({ label = '載入中…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-ink-muted" role="status">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  )
}

const TONE = {
  info: { icon: Info, ring: 'ring-hairline', text: 'text-ink-2', iconColor: 'text-ink-muted' },
  success: { icon: CheckCircle2, ring: 'ring-good/40', text: 'text-ink', iconColor: 'text-good' },
  warning: {
    icon: AlertTriangle,
    ring: 'ring-warning/50',
    text: 'text-ink',
    iconColor: 'text-serious',
  },
  error: { icon: XCircle, ring: 'ring-critical/40', text: 'text-ink', iconColor: 'text-critical' },
} as const

export type Tone = keyof typeof TONE

/** 狀態訊息一律是「圖示 + 文字」，不靠顏色單獨傳達意義 */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const { icon: Icon, ring, text, iconColor } = TONE[tone]
  return (
    <div
      className={cn('flex gap-3 rounded-2xl bg-surface p-4 ring-1', ring, className)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', iconColor)} aria-hidden />
      <div className={cn('min-w-0 flex-1 text-sm', text)}>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-1', 'text-ink-2')}>{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-ink-muted">{icon}</div>}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <p className="max-w-xs text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
