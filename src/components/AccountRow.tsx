import { ChevronRight, CircleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ACCOUNT_TYPE_LABEL } from '@shared/model'
import { DeltaBadge } from '@/components/DeltaBadge'
import type { AccountView } from '@/lib/derive'
import { cn } from '@/lib/cn'
import { formatMoney, formatSince, formatTwd } from '@/lib/format'
import { TYPE_COLOR_VAR } from '@/lib/palette'

interface AccountRowProps {
  view: AccountView
  /** 連到帳戶編輯頁；不給就只是純顯示 */
  href?: string
  showDelta?: boolean
}

export function AccountRow({ view, href, showDelta = true }: AccountRowProps) {
  const { account, amount, amountTwd, deltaTwd, lastUpdated, isStale } = view
  const isForeign = account.currency !== 'TWD'

  const body = (
    <>
      <span
        aria-hidden
        className="mt-1.5 size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: TYPE_COLOR_VAR[account.type] }}
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-medium text-ink">{account.name}</span>
          {account.is_liability && (
            <span className="shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-ink-muted">
              負債
            </span>
          )}
        </span>

        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
          <span>{ACCOUNT_TYPE_LABEL[account.type]}</span>
          {lastUpdated ? (
            <span className={cn(isStale && 'text-serious')}>・更新於 {formatSince(lastUpdated)}</span>
          ) : (
            <span className="text-serious">・尚未填過金額</span>
          )}
          {isStale && <CircleAlert className="size-3.5 text-serious" aria-label="待更新" />}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span className="block font-semibold text-ink tnum">
          {account.is_liability && amountTwd > 0 ? '−' : ''}
          {formatTwd(amountTwd)}
        </span>
        {isForeign && (
          <span className="block text-sm text-ink-muted tnum">
            {formatMoney(amount, account.currency)}
          </span>
        )}
        {showDelta && view.previous && (
          <DeltaBadge
            delta={deltaTwd}
            invert={account.is_liability}
            showPercent={false}
            size="sm"
            className="mt-0.5"
          />
        )}
      </span>
    </>
  )

  const className = 'flex w-full items-start gap-3 px-4 py-3.5 text-left'

  if (!href) {
    return <div className={className}>{body}</div>
  }

  return (
    <Link to={href} className={cn(className, 'active:bg-sunken')}>
      {body}
      <ChevronRight className="mt-2 size-4 shrink-0 text-ink-muted" aria-hidden />
    </Link>
  )
}
