import { useQuery } from '@tanstack/react-query'
import { Check, CloudUpload, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReviewEntryInput } from '@shared/model'
import { delta, fxRateFor, sumTotals, type Totals } from '@shared/money'
import { DeltaBadge } from '@/components/DeltaBadge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, LoadingBlock, Notice } from '@/components/ui/Feedback'
import { Field, TextInput } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { useOverview } from '@/hooks/useData'
import { useSubmitReview } from '@/hooks/useMutations'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { AccountView } from '@/lib/derive'
import { groupAccounts } from '@/lib/grouping'
import {
  formatAmountWhileTyping,
  formatDateFull,
  formatMoney,
  formatTwd,
  parseAmountInput,
  todayIso,
} from '@/lib/format'

type Draft = Record<string, string>

interface Line {
  view: AccountView
  /** 輸入框裡的原始文字（含千分位） */
  raw: string
  /** 這次填的金額（原幣別）；沒填就是 null */
  entered: number | null
  /** 實際採計的金額：沒填就沿用既有的值 */
  effective: number | null
  amountTwd: number
}

function buildLines(views: readonly AccountView[], draft: Draft, usdRate: number): Line[] {
  return views.map((view) => {
    const raw = draft[view.account.id] ?? ''
    const entered = parseAmountInput(raw)
    const previous = view.latest?.amount ?? null
    const effective = entered ?? previous
    const rate = fxRateFor(view.account.currency, usdRate)
    return {
      view,
      raw,
      entered,
      effective,
      amountTwd: effective === null ? 0 : Math.round(effective * rate * 100) / 100,
    }
  })
}

function totalsOf(lines: readonly Line[]): Totals {
  return sumTotals(
    lines
      .filter((l) => l.effective !== null)
      .map((l) => ({ isLiability: l.view.account.is_liability, amountTwd: l.amountTwd })),
  )
}

export function Review() {
  const navigate = useNavigate()
  const { data, overview } = useOverview()
  const submit = useSubmitReview()

  const fx = useQuery({
    queryKey: ['fx'],
    queryFn: () => api.getFx(),
    staleTime: 10 * 60 * 1000,
  })

  const [date, setDate] = useState(todayIso())
  const [rateInput, setRateInput] = useState('')
  const [draft, setDraft] = useState<Draft>({})
  const [scope, setScope] = useState<'pending' | 'all'>('pending')
  const [done, setDone] = useState<{
    queued: boolean
    merged: boolean
    carriedForward: string[]
    addedAccounts: string[]
    updatedCount: number
  } | null>(null)

  const views = overview?.accounts ?? []
  const hasUsd = views.some((v) => v.account.currency === 'USD')

  /** 選到的日期已經盤點過的話，送出會併進那一筆而不是另外開一筆 */
  const existingReview = data?.reviews.find((r) => r.date === date)

  /** 這個日期還沒有納入的帳戶 —— 盤點完才補建的新帳戶會落在這裡 */
  const pendingIds = useMemo(() => {
    if (!data || !existingReview) return new Set<string>()
    const covered = new Set(
      data.snapshots.filter((s) => s.review_id === existingReview.id).map((s) => s.account_id),
    )
    return new Set(views.filter((v) => !covered.has(v.account.id)).map((v) => v.account.id))
  }, [data, existingReview, views])

  const usdRate = useMemo(() => {
    const typed = parseAmountInput(rateInput)
    if (typed && typed > 0) return typed
    return fx.data?.rate ?? 0
  }, [rateInput, fx.data])

  const lines = useMemo(() => buildLines(views, draft, usdRate), [views, draft, usdRate])
  const totals = useMemo(() => totalsOf(lines), [lines])
  const netDelta = delta(totals.netWorth, overview?.totals.netWorth ?? null)
  const filledCount = lines.filter((l) => l.entered !== null).length

  // 併入模式才需要過濾 —— 新的一天本來就每個帳戶都要看
  const showScopeFilter = existingReview !== undefined && pendingIds.size > 0
  const visibleLines =
    showScopeFilter && scope === 'pending'
      ? lines.filter((l) => pendingIds.has(l.view.account.id))
      : lines

  const groups = useMemo(() => {
    const byId = new Map(visibleLines.map((l) => [l.view.account.id, l]))
    return groupAccounts(visibleLines.map((l) => l.view)).map((group) => ({
      ...group,
      lines: group.items.map((v) => byId.get(v.account.id)!).filter(Boolean),
    }))
  }, [visibleLines])

  if (!overview) return <LoadingBlock />

  if (views.length === 0) {
    return (
      <EmptyState
        title="還沒有帳戶可以盤點"
        description="先去「帳戶」頁建立你要追蹤的帳戶。"
        action={<Button onClick={() => navigate('/accounts/new')}>新增帳戶</Button>}
      />
    )
  }

  function cancel() {
    const hasInput = Object.values(draft).some((v) => v.trim() !== '')
    if (hasInput && !window.confirm('要放棄這次盤點嗎？已經填的內容不會儲存。')) return
    navigate('/')
  }

  async function send() {
    const entries: ReviewEntryInput[] = lines
      .filter((l) => l.entered !== null)
      .map((l) => ({ account_id: l.view.account.id, amount: l.entered!, note: '' }))

    const result = await submit.mutateAsync({
      date,
      usd_twd_rate: hasUsd ? usdRate : 1,
      note: '',
      entries,
    })

    setDone({
      queued: result.status === 'queued',
      merged: result.status === 'sent' ? result.merged : Boolean(existingReview),
      carriedForward: result.status === 'sent' ? result.carriedForward : [],
      addedAccounts: result.status === 'sent' ? result.addedAccounts : [],
      updatedCount: result.status === 'sent' ? result.updatedCount : 0,
    })
  }

  /* ---------------------------------------------------------------- */
  /* 完成                                                              */
  /* ---------------------------------------------------------------- */

  if (done) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center safe-top safe-bottom">
        <div
          className={cn(
            'flex size-16 items-center justify-center rounded-full bg-sunken',
            done.queued ? 'text-serious' : 'text-good',
          )}
        >
          {done.queued ? <CloudUpload className="size-8" /> : <Check className="size-8" />}
        </div>

        <div>
          <h1 className="text-xl font-semibold">
            {done.queued ? '已存在這台裝置' : done.merged ? '已併入當天的盤點' : '盤點完成'}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {done.queued
              ? '目前沒有網路，恢復連線後會自動寫進 Google Sheet。'
              : done.merged
                ? `${formatDateFull(date)} 原本就有一筆盤點，這次的內容已經併進去。`
                : `${formatDateFull(date)} 的紀錄已寫入 Google Sheet。`}
          </p>
        </div>

        <p className="text-3xl font-semibold tracking-tight">{formatTwd(totals.netWorth)}</p>
        {overview.hasReviews && <DeltaBadge delta={netDelta} />}

        {done.addedAccounts.length > 0 && (
          <Notice tone="success" title="這次補進了" className="text-left">
            {done.addedAccounts.join('、')}
          </Notice>
        )}

        {done.merged && done.updatedCount > 0 && (
          <Notice tone="info" className="text-left">
            更新了 {done.updatedCount} 個帳戶的金額，其餘維持當天原本填的值。
          </Notice>
        )}

        {done.carriedForward.length > 0 && (
          <Notice tone="info" title="以下帳戶沿用了上次的金額" className="text-left">
            {done.carriedForward.join('、')}
          </Notice>
        )}

        <Button block size="lg" onClick={() => navigate('/')}>
          回到首頁
        </Button>
      </div>
    )
  }

  /* ---------------------------------------------------------------- */
  /* 盤點（單頁）                                                      */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex min-h-dvh flex-col">
      {/* safe-top 只由 header 負責，外層再加一次會變成兩倍留白 */}
      <header className="sticky top-0 z-10 border-b border-hairline bg-plane/90 px-4 pt-3 pb-3 backdrop-blur-xl safe-top">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">盤點</h1>
            <p className="text-sm text-ink-muted">
              已填 {filledCount} / {views.length} 個帳戶
            </p>
          </div>
          <button
            type="button"
            onClick={cancel}
            aria-label="結束盤點"
            className="-mr-2 flex size-10 shrink-0 items-center justify-center rounded-full text-ink-2 active:bg-sunken"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">
        <Card className="space-y-4">
          <div className={cn('grid gap-4', hasUsd && 'grid-cols-2')}>
            <Field label="盤點日期">
              {(id) => (
                <TextInput
                  id={id}
                  type="date"
                  value={date}
                  max={todayIso()}
                  onChange={(e) => setDate(e.target.value)}
                />
              )}
            </Field>

            {hasUsd && (
              <Field label="美元匯率">
                {(id) => (
                  <TextInput
                    id={id}
                    inputMode="decimal"
                    value={rateInput || (fx.data ? String(fx.data.rate) : '')}
                    placeholder={fx.isLoading ? '取得中…' : '32.0'}
                    onChange={(e) => setRateInput(formatAmountWhileTyping(e.target.value))}
                  />
                )}
              </Field>
            )}
          </div>

          {hasUsd && fx.data?.note && (
            <p className="text-sm text-serious">{fx.data.note}</p>
          )}
        </Card>

        {existingReview && (
          <Notice tone="info" title="這一天已經盤點過了">
            送出後會<strong>併入</strong>那一筆。只有你改動的帳戶會被更新，沒填的維持當天原本的金額。
          </Notice>
        )}

        {showScopeFilter && (
          <Segmented
            aria-label="要顯示哪些帳戶"
            className="w-full"
            options={[
              { value: 'pending', label: `待補 (${pendingIds.size})` },
              { value: 'all', label: `全部 (${views.length})` },
            ]}
            value={scope}
            onChange={setScope}
          />
        )}

        <p className="px-1 text-sm text-ink-muted">
          不用改的留空就好
          {existingReview ? '，會維持當天原本的金額。' : '，會沿用上次的金額。'}
        </p>

        {groups.map((group) => (
          <section key={group.key}>
            <h2 className="mb-1.5 px-1 text-sm font-medium text-ink-muted">{group.label}</h2>
            <Card className="p-0">
              <ul className="divide-y divide-hairline">
                {group.lines.map((line) => (
                  <li key={line.view.account.id}>
                    <AmountRow
                      line={line}
                      usdRate={usdRate}
                      onChange={(value) =>
                        setDraft((d) => ({ ...d, [line.view.account.id]: value }))
                      }
                    />
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))}

        {submit.error && <Notice tone="error">{(submit.error as Error).message}</Notice>}
      </main>

      <footer className="sticky bottom-0 border-t border-hairline bg-surface/90 px-4 pt-3 pb-3 backdrop-blur-xl safe-bottom">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink-muted">盤點後的淨資產</p>
            <p className="text-2xl leading-tight font-semibold tracking-tight">
              {formatTwd(totals.netWorth)}
            </p>
          </div>
          {overview.hasReviews && <DeltaBadge delta={netDelta} size="sm" />}
        </div>

        <Button
          block
          size="lg"
          loading={submit.isPending}
          disabled={hasUsd && usdRate <= 0}
          onClick={() => void send()}
        >
          {existingReview ? '併入當天的盤點' : '送出盤點'}
        </Button>
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function AmountRow({
  line,
  usdRate,
  onChange,
}: {
  line: Line
  usdRate: number
  onChange: (value: string) => void
}) {
  const { view, entered } = line
  const { account } = view
  const previous = view.latest?.amount ?? null
  const rate = fxRateFor(account.currency, usdRate)
  const inputId = `amount-${account.id}`

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="block truncate font-medium text-ink">
          {account.name}
        </label>
        <p className="mt-0.5 truncate text-sm text-ink-muted">
          {previous === null ? (
            <span className="text-serious">還沒填過</span>
          ) : (
            <>上次 {formatMoney(previous, account.currency)}</>
          )}
          {account.currency === 'USD' && entered !== null && (
            <> ・≈ {formatTwd(entered * rate)}</>
          )}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <div className="flex items-baseline justify-end gap-1">
          <span className="text-sm text-ink-muted">
            {account.currency === 'USD' ? 'US$' : 'NT$'}
          </span>
          {/*
            留空就是「不改」—— 所以 placeholder 直接放既有的金額，
            讓「我不填的話會算成多少」一眼就看得到。
          */}
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder={previous === null ? '0' : formatAmountWhileTyping(String(previous))}
            value={line.raw}
            onChange={(e) => onChange(formatAmountWhileTyping(e.target.value))}
            onFocus={(e) => e.currentTarget.select()}
            className={cn(
              'w-28 min-w-0 rounded-xl bg-sunken px-2.5 py-2 text-right font-medium tabular-nums',
              'text-ink ring-1 ring-hairline placeholder:font-normal placeholder:text-ink-muted',
              'focus:outline-2 focus:outline-offset-0 focus:outline-brand',
            )}
          />
        </div>

        {entered !== null && previous !== null && (
          <DeltaBadge
            delta={delta(entered * rate, previous * rate)}
            invert={account.is_liability}
            showPercent={false}
            size="sm"
            className="mt-0.5"
          />
        )}
      </div>
    </div>
  )
}
