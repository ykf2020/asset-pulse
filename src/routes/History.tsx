import { CalendarClock, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { delta } from '@shared/money'
import { DeltaBadge } from '@/components/DeltaBadge'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/Card'
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { useOverview } from '@/hooks/useData'
import { formatDateFull, formatTwd } from '@/lib/format'

export function History() {
  const { data, overview } = useOverview()

  if (!data || !overview) return <LoadingBlock />

  // 以 Reviews 當列表（那是「一次盤點」的單位），數字則用重算後的趨勢點
  const trendByDate = new Map(overview.trend.map((p) => [p.date, p]))
  const reviews = [...data.reviews].sort((a, b) => b.date.localeCompare(a.date))

  if (reviews.length === 0) {
    return (
      <div>
        <PageHeader title="歷史" />
        <EmptyState
          icon={<CalendarClock className="size-10" />}
          title="還沒有任何盤點紀錄"
          description="每週挑一天，把各個帳戶的金額填一次，這裡就會長出你的資產軌跡。"
        />
      </div>
    )
  }

  return (
    <div className="pb-6">
      <PageHeader title="歷史" subtitle={`共 ${reviews.length} 次盤點`} />

      <div className="px-4">
        <Card className="p-0">
          <ul className="divide-y divide-hairline">
            {reviews.map((review, index) => {
              const point = trendByDate.get(review.date)
              const netWorth = point?.netWorth ?? review.net_worth_twd
              const prevReview = reviews[index + 1]
              const prevPoint = prevReview ? trendByDate.get(prevReview.date) : undefined
              const prevNet = prevPoint?.netWorth ?? prevReview?.net_worth_twd ?? null

              return (
                <li key={review.id}>
                  <Link
                    to={`/history/${review.id}`}
                    className="flex items-center gap-3 px-4 py-3.5 active:bg-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink">
                        {formatDateFull(review.date)}
                      </span>
                      <span className="mt-0.5 block">
                        <DeltaBadge delta={delta(netWorth, prevNet)} size="sm" />
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-semibold text-ink tnum">
                      {formatTwd(netWorth)}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>
    </div>
  )
}
