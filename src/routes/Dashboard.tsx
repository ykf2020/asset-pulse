import { CloudOff, PlusCircle, RefreshCw, Sparkles, Wallet } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { AssetLiabilityBars } from '@/components/charts/AssetLiabilityBars'
import { AccountRow } from '@/components/AccountRow'
import { DeltaBadge } from '@/components/DeltaBadge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, LoadingBlock, Notice } from '@/components/ui/Feedback'
import { useData, useOnlineStatus, useOverview, useSync } from '@/hooks/useData'
import { useBootstrap } from '@/hooks/useMutations'
import { formatDate, formatTwd } from '@/lib/format'

/**
 * 圖表會把 Recharts（連同 d3）拉進 bundle，佔了快七成體積。延後載入讓淨資產
 * 那個大數字可以先畫出來 —— 開 App 第一眼要看的就是它。
 */
const NetWorthTrend = lazy(() =>
  import('@/components/charts/NetWorthTrend').then((m) => ({ default: m.NetWorthTrend })),
)
const AllocationDonut = lazy(() =>
  import('@/components/charts/AllocationDonut').then((m) => ({ default: m.AllocationDonut })),
)

/** 佔位高度與圖表本身一致，載入完成時不會跳版 */
function ChartFallback({ height }: { height: number }) {
  return <div style={{ height }} aria-hidden />
}

export function Dashboard() {
  const { isLoading, isFetching, error, refetch } = useData()
  const { data, overview } = useOverview()
  const online = useOnlineStatus()
  const { pending } = useSync(true)
  const bootstrap = useBootstrap()

  if (!data && isLoading) return <LoadingBlock />

  if (!data) {
    return (
      <div className="px-5 py-10">
        <Notice
          tone="error"
          title="讀不到資料"
          action={
            <Button size="sm" variant="secondary" onClick={() => void refetch()}>
              重試
            </Button>
          }
        >
          {error instanceof Error ? error.message : '請確認網路與伺服器設定。'}
        </Notice>
      </div>
    )
  }

  if (data.needsBootstrap) {
    return (
      <div className="space-y-4 px-5 py-10">
        <Notice tone="warning" title="Google Sheet 還沒初始化">
          需要先在這份試算表建立 Accounts / Snapshots / Reviews / Settings 四個分頁。
          現有的資料不會被動到。
        </Notice>
        <Button
          block
          loading={bootstrap.isPending}
          onClick={() => bootstrap.mutate()}
          icon={<Sparkles className="size-5" />}
        >
          幫我建立分頁
        </Button>
        {bootstrap.error && (
          <Notice tone="error">{(bootstrap.error as Error).message}</Notice>
        )}
      </div>
    )
  }

  if (!overview) return <LoadingBlock />

  if (!overview.hasAccounts) {
    return (
      <EmptyState
        icon={<Wallet className="size-10" />}
        title="先建立第一個帳戶"
        description="銀行、期貨戶、虛擬貨幣交易所、信貸都算 —— 之後每週盤點就是逐一填入它們的金額。"
        action={
          <Button asChild icon={<PlusCircle className="size-5" />}>
            <Link to="/accounts/new">新增帳戶</Link>
          </Button>
        }
      />
    )
  }

  const { totals, netWorthDelta, latestDate, previousDate, staleAccounts } = overview

  return (
    <div className="space-y-4 px-4 pb-6">
      {/* ── 英雄數字：整頁唯一的大數字，用比例字寬不用等寬 ── */}
      <section className="px-1 pt-2" aria-labelledby="networth-heading">
        <h1 id="networth-heading" className="text-sm font-medium text-ink-muted">
          淨資產
        </h1>
        <p className="mt-1 text-[clamp(2.5rem,12vw,3.25rem)] leading-none font-semibold tracking-tight text-ink">
          {formatTwd(totals.netWorth)}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {overview.previousTotals ? (
            <>
              <DeltaBadge delta={netWorthDelta} size="sm" />
              <span className="text-ink-muted">
                較 {previousDate ? formatDate(previousDate, 'M/d') : '上次'}
              </span>
            </>
          ) : (
            <span className="text-ink-muted">第一次盤點，之後就能看到變化</span>
          )}
          {latestDate && (
            <span className="text-ink-muted">・盤點於 {formatDate(latestDate, 'M/d')}</span>
          )}
        </div>
      </section>

      {/* ── 需要注意的事 ── */}
      {!online && (
        <Notice tone="info" title="目前離線">
          顯示的是上次同步的資料。盤點照樣可以填，恢復連線會自動送出。
        </Notice>
      )}

      {pending.length > 0 && (
        <Notice
          tone="warning"
          title={`有 ${pending.length} 筆盤點還沒送出`}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link to="/settings">前往處理</Link>
            </Button>
          }
        >
          {pending[0]?.lastError ?? '等待網路恢復中。'}
        </Notice>
      )}

      {data.warnings.length > 0 && (
        <Notice tone="warning" title="Google Sheet 有幾列讀不懂">
          <ul className="list-disc space-y-0.5 pl-4">
            {data.warnings.slice(0, 3).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}

      {staleAccounts.length > 0 && (
        <Notice tone="info" title={`${staleAccounts.length} 個帳戶該更新了`}>
          {staleAccounts.map((v) => v.account.name).join('、')}
        </Notice>
      )}

      <Button asChild block size="lg" icon={<RefreshCw className="size-5" />}>
        <Link to="/review">開始盤點</Link>
      </Button>

      <Card>
        <AssetLiabilityBars totals={totals} />
      </Card>

      {overview.hasReviews && (
        <Card>
          <Suspense fallback={<ChartFallback height={300} />}>
            <NetWorthTrend points={overview.trend} />
          </Suspense>
        </Card>
      )}

      <Card>
        <Suspense fallback={<ChartFallback height={320} />}>
          <AllocationDonut
            byType={overview.byType}
            byCurrency={overview.byCurrency}
            total={totals.assets}
          />
        </Suspense>
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-base font-semibold text-ink">各帳戶</h2>
          <Link to="/accounts" className="text-sm text-brand">
            管理
          </Link>
        </div>
        <ul className="divide-y divide-hairline">
          {overview.accounts.map((view) => (
            <li key={view.account.id}>
              <AccountRow view={view} href={`/accounts/${view.account.id}`} />
            </li>
          ))}
        </ul>
      </Card>

      <p className="flex items-center justify-center gap-1.5 pt-1 text-xs text-ink-muted">
        {isFetching ? (
          <>
            <RefreshCw className="size-3.5 animate-spin" aria-hidden />
            更新中…
          </>
        ) : online ? (
          `資料更新於 ${formatDate(data.fetchedAt.slice(0, 10), 'M/d')}`
        ) : (
          <>
            <CloudOff className="size-3.5" aria-hidden />
            離線快取
          </>
        )}
      </p>
    </div>
  )
}
