import { Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fxRateFor, sumTotals } from '@shared/money'
import { DeltaBadge } from '@/components/DeltaBadge'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { LoadingBlock, Notice } from '@/components/ui/Feedback'
import { Field, TextInput } from '@/components/ui/Field'
import { useData } from '@/hooks/useData'
import { useDeleteReview, useUpdateReview } from '@/hooks/useMutations'
import { buildReviewDetail } from '@/lib/derive'
import {
  formatAmountWhileTyping,
  formatDateFull,
  formatMoney,
  formatTwd,
  parseAmountInput,
} from '@/lib/format'

export function ReviewDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data } = useData()
  const update = useUpdateReview()
  const remove = useDeleteReview()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [rateInput, setRateInput] = useState('')

  const review = data?.reviews.find((r) => r.id === id)
  const detail = useMemo(
    () => (data && review ? buildReviewDetail(review, data) : null),
    [data, review],
  )

  if (!data) return <LoadingBlock />
  if (!review || !detail) {
    return (
      <div>
        <PageHeader title="盤點明細" back="/history" />
        <div className="px-5 py-6">
          <Notice tone="error" title="找不到這筆盤點紀錄" />
        </div>
      </div>
    )
  }

  const rate = parseAmountInput(rateInput) ?? review.usd_twd_rate

  function startEdit() {
    setDraft(
      Object.fromEntries(
        detail!.rows.map((row) => [
          row.snapshot.account_id,
          formatAmountWhileTyping(String(row.snapshot.amount)),
        ]),
      ),
    )
    setRateInput(String(review!.usd_twd_rate))
    setEditing(true)
  }

  // 編輯中的即時總額，讓使用者改完馬上看到淨資產變成多少
  const previewTotals = editing
    ? sumTotals(
        detail.rows.map((row) => {
          const amount = parseAmountInput(draft[row.snapshot.account_id] ?? '') ?? row.snapshot.amount
          const currency = row.account?.currency ?? row.snapshot.currency
          return {
            isLiability: row.account?.is_liability ?? false,
            amountTwd: amount * fxRateFor(currency, rate),
          }
        }),
      )
    : detail.totals

  async function save() {
    const entries = detail!.rows
      .map((row) => {
        const amount = parseAmountInput(draft[row.snapshot.account_id] ?? '')
        if (amount === null || amount === row.snapshot.amount) return null
        return { account_id: row.snapshot.account_id, amount, note: row.snapshot.note }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)

    const patch: Parameters<typeof update.mutateAsync>[0]['patch'] = {}
    if (entries.length) patch.entries = entries
    if (rate !== review!.usd_twd_rate) patch.usd_twd_rate = rate

    if (Object.keys(patch).length > 0) {
      await update.mutateAsync({ id: review!.id, patch })
    }
    setEditing(false)
  }

  async function handleDelete() {
    if (!window.confirm(`確定要刪除 ${formatDateFull(review!.date)} 的整筆盤點紀錄嗎？`)) return
    await remove.mutateAsync(review!.id)
    navigate('/history')
  }

  const hasUsd = detail.rows.some((r) => (r.account?.currency ?? r.snapshot.currency) === 'USD')

  return (
    <div className="pb-8">
      <PageHeader
        title={formatDateFull(review.date)}
        subtitle={hasUsd ? `美元匯率 ${review.usd_twd_rate}` : undefined}
        back="/history"
        action={
          !editing && (
            <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={startEdit}>
              修正
            </Button>
          )
        }
      />

      <div className="space-y-4 px-4">
        <Card>
          <p className="text-sm text-ink-muted">當時淨資產</p>
          <p className="mt-1 text-[2.25rem] leading-none font-semibold tracking-tight">
            {formatTwd(previewTotals.netWorth)}
          </p>
          <dl className="mt-4 flex gap-6 border-t border-hairline pt-3 text-sm">
            <div>
              <dt className="text-ink-muted">總資產</dt>
              <dd className="font-medium tnum">{formatTwd(previewTotals.assets)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">總負債</dt>
              <dd className="font-medium tnum">{formatTwd(previewTotals.liabilities)}</dd>
            </div>
          </dl>
        </Card>

        {editing && hasUsd && (
          <Card>
            <Field label="美元匯率（USD → TWD）" hint="改匯率會重算這次所有美元帳戶的台幣值">
              {(fieldId) => (
                <TextInput
                  id={fieldId}
                  inputMode="decimal"
                  value={rateInput}
                  onChange={(e) => setRateInput(formatAmountWhileTyping(e.target.value))}
                />
              )}
            </Field>
          </Card>
        )}

        <Card className="p-0">
          <ul className="divide-y divide-hairline">
            {detail.rows.map((row) => {
              const accountId = row.snapshot.account_id
              const currency = row.account?.currency ?? row.snapshot.currency
              return (
                <li key={row.snapshot.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">
                        {row.account?.name ?? '（已刪除的帳戶）'}
                      </p>
                      {row.snapshot.note && (
                        <p className="text-sm text-ink-muted">{row.snapshot.note}</p>
                      )}
                    </div>

                    {editing ? (
                      <div className="flex w-40 shrink-0 items-baseline gap-1">
                        <span className="text-sm text-ink-muted">
                          {currency === 'USD' ? 'US$' : 'NT$'}
                        </span>
                        <input
                          inputMode="decimal"
                          value={draft[accountId] ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              [accountId]: formatAmountWhileTyping(e.target.value),
                            }))
                          }
                          className="w-full min-w-0 rounded-xl bg-sunken px-2 py-1.5 text-right text-ink tabular-nums ring-1 ring-hairline focus:outline-2 focus:outline-brand"
                        />
                      </div>
                    ) : (
                      <div className="shrink-0 text-right">
                        <p className="font-medium text-ink tnum">
                          {row.account?.is_liability && row.amountTwd > 0 ? '−' : ''}
                          {formatTwd(row.amountTwd)}
                        </p>
                        {currency === 'USD' && (
                          <p className="text-sm text-ink-muted tnum">
                            {formatMoney(row.snapshot.amount, 'USD')}
                          </p>
                        )}
                        <DeltaBadge
                          delta={row.deltaTwd}
                          invert={row.account?.is_liability}
                          showPercent={false}
                          size="sm"
                        />
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>

        {(update.error || remove.error) && (
          <Notice tone="error">{((update.error ?? remove.error) as Error).message}</Notice>
        )}

        {editing ? (
          <div className="flex gap-3">
            <Button variant="secondary" size="lg" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button block size="lg" loading={update.isPending} onClick={() => void save()}>
              儲存修正
            </Button>
          </div>
        ) : (
          <Button
            block
            variant="ghost"
            className="text-critical"
            icon={<Trash2 className="size-5" />}
            loading={remove.isPending}
            onClick={() => void handleDelete()}
          >
            刪除這次盤點
          </Button>
        )}
      </div>
    </div>
  )
}
