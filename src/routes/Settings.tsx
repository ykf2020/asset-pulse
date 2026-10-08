import { ExternalLink, LockKeyhole, RotateCcw, Trash2, UploadCloud } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/app/auth'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { LoadingBlock, Notice } from '@/components/ui/Feedback'
import { Field, SelectInput } from '@/components/ui/Field'
import { useData, useOnlineStatus, useSync } from '@/hooks/useData'
import { useRecalc, useUpdateSettings } from '@/hooks/useMutations'
import { formatDateFull, formatSince } from '@/lib/format'

const STALE_OPTIONS = [3, 7, 10, 14, 30, 60]

export function Settings() {
  const { data } = useData()
  const { lock } = useAuth()
  const online = useOnlineStatus()
  const { pending, syncing, flush, discard } = useSync(true)
  const updateSettings = useUpdateSettings()
  const recalc = useRecalc()
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null)

  if (!data) return <LoadingBlock />

  return (
    <div className="pb-8">
      <PageHeader title="設定" />

      <div className="space-y-4 px-4">
        {pending.length > 0 && (
          <Card>
            <CardHeader
              title={`${pending.length} 筆盤點待送出`}
              subtitle={online ? '連線中，可以重試' : '等待網路恢復'}
            />
            <ul className="space-y-3">
              {pending.map((item) => (
                <li key={item.id} className="rounded-2xl bg-sunken p-3 text-sm">
                  <p className="font-medium text-ink">{formatDateFull(item.payload.date)}</p>
                  <p className="text-ink-muted">
                    {item.payload.entries.length} 個帳戶・排入於 {formatSince(item.queuedAt.slice(0, 10))}
                  </p>
                  {item.lastError && (
                    <p className="mt-1 text-serious">{item.lastError}</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={syncing}
                      disabled={!online}
                      icon={<UploadCloud className="size-4" />}
                      onClick={() => void flush()}
                    >
                      重試
                    </Button>
                    {item.lastError && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-critical"
                        icon={<Trash2 className="size-4" />}
                        onClick={() => void discard(item.id)}
                      >
                        捨棄
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title="資料來源" subtitle="這個 App 只是 Google Sheet 的介面" />
          <p className="text-sm text-ink-2">
            所有資料都寫在你自己的 Google Sheet 裡。隨時可以直接打開它編輯、匯出，
            或是乾脆不用這個 App。
          </p>
          <Button asChild block variant="secondary" className="mt-3" icon={<ExternalLink className="size-5" />}>
            <a href={data.sheetUrl} target="_blank" rel="noreferrer">
              開啟 Google Sheet
            </a>
          </Button>
        </Card>

        <Card>
          <CardHeader
            title="提醒設定"
            subtitle="帳戶多久沒更新要在首頁標示「待更新」"
          />
          <Field label="待更新門檻">
            {(id) => (
              <SelectInput
                id={id}
                value={String(data.settings.stale_days)}
                onChange={(e) =>
                  updateSettings.mutate({ stale_days: Number(e.target.value) })
                }
              >
                {STALE_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    超過 {d} 天
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          {updateSettings.error && (
            <Notice tone="error" className="mt-3">
              {(updateSettings.error as Error).message}
            </Notice>
          )}
        </Card>

        <Card>
          <CardHeader
            title="重新計算彙總"
            subtitle="手動改過 Google Sheet 之後用"
          />
          <p className="text-sm text-ink-2">
            App 的數字一律由明細的「金額 × 匯率」現算，所以永遠是對的。
            這個動作是把 Sheet 上的 <code className="rounded bg-sunken px-1">amount_twd</code> 與
            每次盤點的彙總欄位補成一致，讓你直接看 Sheet 時也不會看到舊數字。
          </p>
          <Button
            block
            variant="secondary"
            className="mt-3"
            loading={recalc.isPending}
            icon={<RotateCcw className="size-5" />}
            onClick={() =>
              recalc.mutate(undefined, {
                onSuccess: (r) => setRecalcMessage(r.message),
              })
            }
          >
            重新計算
          </Button>
          {recalcMessage && (
            <Notice tone="success" className="mt-3">
              {recalcMessage}
            </Notice>
          )}
          {recalc.error && (
            <Notice tone="error" className="mt-3">
              {(recalc.error as Error).message}
            </Notice>
          )}
        </Card>

        <Card>
          <CardHeader title="安全" />
          <Button
            block
            variant="secondary"
            icon={<LockKeyhole className="size-5" />}
            onClick={() => void lock()}
          >
            鎖定（保留離線快取）
          </Button>
          <Button
            block
            variant="ghost"
            className="mt-2 text-critical"
            onClick={() => {
              if (window.confirm('會清除這台裝置上的離線快取與待送出佇列，確定嗎？')) {
                void lock({ wipeCache: true })
              }
            }}
          >
            鎖定並清除本機資料
          </Button>
        </Card>

        <p className="pt-2 text-center text-xs text-ink-muted">
          {data.accounts.length} 個帳戶・{data.reviews.length} 次盤點・
          {data.snapshots.length} 筆明細
        </p>
      </div>
    </div>
  )
}
