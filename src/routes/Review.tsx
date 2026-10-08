import { useQuery } from '@tanstack/react-query'
import { Check, CloudUpload, SkipForward, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ACCOUNT_TYPE_HINT, ACCOUNT_TYPE_LABEL, type ReviewEntryInput } from '@shared/model'
import { delta, fxRateFor, snapshotTwd, sumTotals, type Totals } from '@shared/money'
import { AmountInput } from '@/components/AmountInput'
import { DeltaBadge } from '@/components/DeltaBadge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, LoadingBlock, Notice } from '@/components/ui/Feedback'
import { Field, TextInput } from '@/components/ui/Field'
import { useOverview } from '@/hooks/useData'
import { useSubmitReview } from '@/hooks/useMutations'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { AccountView } from '@/lib/derive'
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
  /** 這次填的金額（原幣別）；沒填就是 null */
  entered: number | null
  /** 實際採計的金額：沒填就沿用上次 */
  effective: number | null
  amountTwd: number
  carriedForward: boolean
}

function buildLines(views: AccountView[], draft: Draft, usdRate: number): Line[] {
  return views.map((view) => {
    const entered = parseAmountInput(draft[view.account.id] ?? '')
    const previous = view.latest?.amount ?? null
    const effective = entered ?? previous
    const rate = fxRateFor(view.account.currency, usdRate)
    return {
      view,
      entered,
      effective,
      amountTwd: effective === null ? 0 : Math.round(effective * rate * 100) / 100,
      carriedForward: entered === null && previous !== null,
    }
  })
}

function totalsOf(lines: Line[]): Totals {
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
  const [step, setStep] = useState(0)
  const [done, setDone] = useState<{
    queued: boolean
    merged: boolean
    carriedForward: string[]
    addedAccounts: string[]
    updatedCount: number
  } | null>(null)

  /** 選到的日期已經盤點過的話，這次送出會併進那一筆而不是另外開一筆 */
  const existingReview = data?.reviews.find((r) => r.date === date)

  const views = overview?.accounts ?? []
  const hasUsd = views.some((v) => v.account.currency === 'USD')

  const usdRate = useMemo(() => {
    const typed = parseAmountInput(rateInput)
    if (typed && typed > 0) return typed
    return fx.data?.rate ?? 0
  }, [rateInput, fx.data])

  const lines = useMemo(() => buildLines(views, draft, usdRate), [views, draft, usdRate])
  const totals = useMemo(() => totalsOf(lines), [lines])
  const netDelta = delta(totals.netWorth, overview?.totals.netWorth ?? null)

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

  const lastStep = views.length + 1
  const currentView = step >= 1 && step <= views.length ? views[step - 1]! : null
  const progress = (step / lastStep) * 100

  function next() {
    setStep((s) => Math.min(s + 1, lastStep))
  }
  function back() {
    if (step === 0) navigate(-1)
    else setStep((s) => s - 1)
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
            'flex size-16 items-center justify-center rounded-full',
            done.queued ? 'bg-sunken text-serious' : 'bg-sunken text-good',
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
  /* 流程                                                              */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex min-h-dvh flex-col safe-top safe-bottom">
      <header className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={back}
            className="-ml-2 flex size-10 items-center justify-center rounded-full text-ink-2 active:bg-sunken"
            aria-label="上一步"
          >
            <X className="size-5" aria-hidden />
          </button>
          <p className="text-sm font-medium text-ink-2">
            {step === 0
              ? '盤點設定'
              : step === lastStep
                ? '確認送出'
                : `${step} / ${views.length}`}
          </p>
          <span className="size-10" />
        </div>

        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="盤點進度"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      <main className="flex-1 px-4 py-4">
        {/* ── 步驟 0：日期與匯率 ── */}
        {step === 0 && (
          <div className="space-y-4">
            <h1 className="px-1 text-2xl font-semibold">這次盤點</h1>

            <Card className="space-y-4">
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
                <Field
                  label="美元匯率（USD → TWD）"
                  hint={
                    fx.data?.note ??
                    (fx.data?.source === 'live'
                      ? '已帶入今日即時匯率，可以直接改'
                      : '請確認匯率')
                  }
                >
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
            </Card>

            {existingReview && (
              <Notice tone="info" title="這一天已經盤點過了">
                送出後會<strong>併入</strong>那一筆，不會另外開一筆。只有你這次填的帳戶會被更新，
                跳過的維持當天原本的金額。
              </Notice>
            )}

            <p className="px-1 text-sm text-ink-muted">
              接下來會一個帳戶一頁，共 {views.length} 個。
              {existingReview ? '不用改的直接跳過。' : '沒改變的可以直接跳過，會沿用上次的金額。'}
            </p>
          </div>
        )}

        {/* ── 步驟 1..N：逐一填金額 ── */}
        {currentView && (
          <AccountStep
            key={currentView.account.id}
            view={currentView}
            value={draft[currentView.account.id] ?? ''}
            usdRate={usdRate}
            onChange={(v) =>
              setDraft((d) => ({ ...d, [currentView.account.id]: v }))
            }
            onEnter={next}
          />
        )}

        {/* ── 最後一步：確認 ── */}
        {step === lastStep && (
          <div className="space-y-4">
            <h1 className="px-1 text-2xl font-semibold">確認一下</h1>

            <Card>
              <p className="text-sm text-ink-muted">盤點後的淨資產</p>
              <p className="mt-1 text-[2.5rem] leading-none font-semibold tracking-tight">
                {formatTwd(totals.netWorth)}
              </p>
              {overview.hasReviews && (
                <div className="mt-2">
                  <DeltaBadge delta={netDelta} size="sm" />
                </div>
              )}
              <dl className="mt-4 flex gap-6 border-t border-hairline pt-3 text-sm">
                <div>
                  <dt className="text-ink-muted">總資產</dt>
                  <dd className="font-medium tnum">{formatTwd(totals.assets)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">總負債</dt>
                  <dd className="font-medium tnum">{formatTwd(totals.liabilities)}</dd>
                </div>
              </dl>
            </Card>

            <Card className="p-0">
              <ul className="divide-y divide-hairline">
                {lines.map((line) => (
                  <li
                    key={line.view.account.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => setStep(views.indexOf(line.view) + 1)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate font-medium text-ink">
                        {line.view.account.name}
                      </span>
                      <span className="text-sm text-ink-muted">
                        {line.effective === null
                          ? '尚未填過'
                          : line.carriedForward
                            ? '沿用上次'
                            : formatMoney(line.effective, line.view.account.currency)}
                      </span>
                    </button>
                    <span className="shrink-0 text-right">
                      <span className="block font-medium text-ink tnum">
                        {line.view.account.is_liability && line.amountTwd > 0 ? '−' : ''}
                        {formatTwd(line.amountTwd)}
                      </span>
                      <DeltaBadge
                        delta={delta(
                          line.amountTwd,
                          line.view.latest ? snapshotTwd(line.view.latest) : null,
                        )}
                        invert={line.view.account.is_liability}
                        showPercent={false}
                        size="sm"
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {submit.error && <Notice tone="error">{(submit.error as Error).message}</Notice>}
          </div>
        )}
      </main>

      <footer className="sticky bottom-0 border-t border-hairline bg-surface/90 px-4 py-3 backdrop-blur-xl safe-bottom">
        {step === lastStep ? (
          <Button block size="lg" loading={submit.isPending} onClick={() => void send()}>
            {existingReview ? '併入當天的盤點' : '送出盤點'}
          </Button>
        ) : (
          <div className="flex gap-3">
            {currentView && (
              <Button
                variant="secondary"
                size="lg"
                onClick={next}
                icon={<SkipForward className="size-5" />}
              >
                跳過
              </Button>
            )}
            <Button block size="lg" onClick={next} disabled={step === 0 && hasUsd && usdRate <= 0}>
              {step === views.length ? '看看結果' : '下一個'}
            </Button>
          </div>
        )}
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function AccountStep({
  view,
  value,
  usdRate,
  onChange,
  onEnter,
}: {
  view: AccountView
  value: string
  usdRate: number
  onChange: (value: string) => void
  onEnter: () => void
}) {
  const { account, latest } = view
  const entered = parseAmountInput(value)
  const previousAmount = latest?.amount ?? null
  const rate = fxRateFor(account.currency, usdRate)
  const amountTwd = entered === null ? null : entered * rate

  return (
    <div className="space-y-4">
      <div className="px-1">
        <p className="text-sm text-ink-muted">
          {ACCOUNT_TYPE_LABEL[account.type]}
          {account.institution && `・${account.institution}`}
        </p>
        <h1 className="mt-0.5 text-2xl font-semibold">{account.name}</h1>
        {ACCOUNT_TYPE_HINT[account.type] && (
          <p className="mt-1 text-sm text-ink-2">{ACCOUNT_TYPE_HINT[account.type]}</p>
        )}
      </div>

      <Card>
        <AmountInput
          value={value}
          onChange={onChange}
          currency={account.currency}
          label={`${account.name} 金額`}
          autoFocus
          onEnter={onEnter}
        />

        {account.currency === 'USD' && amountTwd !== null && (
          <p className="mt-1 text-sm text-ink-muted tnum">
            ≈ {formatTwd(amountTwd)}（匯率 {usdRate}）
          </p>
        )}

        {previousAmount !== null && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-3">
            <div className="min-w-0 text-sm">
              <p className="text-ink-muted">上次（{view.lastUpdated}）</p>
              <p className="font-medium text-ink tnum">
                {formatMoney(previousAmount, account.currency)}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onChange(formatAmountWhileTyping(String(previousAmount)))}
            >
              沿用上次
            </Button>
          </div>
        )}

        {entered !== null && previousAmount !== null && (
          <div className="mt-3">
            <DeltaBadge
              delta={delta(entered * rate, previousAmount * rate)}
              invert={account.is_liability}
            />
          </div>
        )}
      </Card>

      {previousAmount === null && (
        <p className="px-1 text-sm text-ink-muted">
          這個帳戶還沒有歷史紀錄。跳過的話這次就不會被計入。
        </p>
      )}
    </div>
  )
}
