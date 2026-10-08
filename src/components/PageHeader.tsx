import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/cn'

interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  back?: string | true
  action?: ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, back, action, className }: PageHeaderProps) {
  const navigate = useNavigate()

  return (
    <header className={cn('flex items-center gap-2 px-5 pt-3 pb-4', className)}>
      {back && (
        <button
          type="button"
          onClick={() => (back === true ? navigate(-1) : navigate(back))}
          aria-label="返回"
          className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-full text-ink-2 active:bg-sunken"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  )
}
