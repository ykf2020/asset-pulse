import type { Totals } from '@shared/money'
import { cn } from '@/lib/cn'
import { formatPercent, formatTwd } from '@/lib/format'
import { ASSET_COLOR_VAR, LIABILITY_COLOR_VAR } from '@/lib/palette'

interface Row {
  key: string
  label: string
  value: number
  color: string
}

/**
 * 資產與負債擺在同一條刻度上比長短 —— 刻意不做成「一條堆疊條」，因為負債並不是
 * 資產的一部分，硬拼成部分對全體會讀出不存在的關係。兩條同尺規的細條就夠了，
 * 而且在負債大於資產時也不會畫壞。
 */
export function AssetLiabilityBars({ totals }: { totals: Totals }) {
  const rows: Row[] = [
    { key: 'assets', label: '總資產', value: totals.assets, color: ASSET_COLOR_VAR },
    { key: 'liabilities', label: '總負債', value: totals.liabilities, color: LIABILITY_COLOR_VAR },
  ]

  const scale = Math.max(totals.assets, totals.liabilities, 1)
  const ratio = totals.assets > 0 ? (totals.liabilities / totals.assets) * 100 : null

  if (totals.liabilities === 0 && totals.assets === 0) return null

  return (
    <section aria-labelledby="al-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="al-heading" className="text-base font-semibold text-ink">
          資產與負債
        </h2>
        {ratio !== null && (
          <p className="text-sm text-ink-muted tnum">
            負債佔資產 {formatPercent(Math.round(ratio * 10) / 10)}
          </p>
        )}
      </div>

      <ul className="space-y-3">
        {rows.map((row) => {
          const width = Math.max((row.value / scale) * 100, row.value > 0 ? 2 : 0)
          return (
            <li key={row.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-ink-2">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                  {row.label}
                </span>
                <span className="text-sm font-medium text-ink tnum">{formatTwd(row.value)}</span>
              </div>
              <div
                className="h-3.5 w-full overflow-hidden rounded-full bg-sunken"
                role="img"
                aria-label={`${row.label} ${formatTwd(row.value)}`}
              >
                <div
                  className={cn('h-full rounded-full transition-[width] duration-500')}
                  style={{ width: `${width}%`, backgroundColor: row.color }}
                />
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mt-4 flex items-baseline justify-between border-t border-hairline pt-3 text-sm">
        <span className="text-ink-2">淨資產</span>
        <span className="font-semibold text-ink tnum">{formatTwd(totals.netWorth)}</span>
      </p>
    </section>
  )
}
