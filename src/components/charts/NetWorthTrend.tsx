import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Segmented } from '@/components/ui/Segmented'
import type { TrendPoint } from '@/lib/derive'
import { formatCompactTwd, formatDate, formatTwd } from '@/lib/format'
import { TREND_COLOR_VAR } from '@/lib/palette'

const RANGES = [
  { value: '3m', label: '3 個月', months: 3 },
  { value: '6m', label: '6 個月', months: 6 },
  { value: '1y', label: '1 年', months: 12 },
  { value: 'all', label: '全部', months: null },
] as const

type RangeValue = (typeof RANGES)[number]['value']

function cutoffFor(months: number | null): string | null {
  if (months === null) return null
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.toISOString().slice(0, 10)
}

interface TooltipPayload {
  active?: boolean
  payload?: { payload: TrendPoint }[]
}

function TrendTooltip({ active, payload }: TooltipPayload) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-xl bg-surface px-3 py-2 text-sm shadow-lg ring-1 ring-hairline">
      <p className="font-medium text-ink">{formatDate(point.date, 'yyyy/M/d')}</p>
      <p className="mt-1 text-ink tnum">淨資產 {formatTwd(point.netWorth)}</p>
      <p className="text-ink-muted tnum">
        資產 {formatTwd(point.assets)}・負債 {formatTwd(point.liabilities)}
      </p>
    </div>
  )
}

/**
 * 單一序列的折線 —— 只有一條線就不需要圖例（標題已經說了它是什麼），
 * 改成直接標註最新一點。數值另外有下方的表格檢視可讀，不只靠 tooltip。
 */
export function NetWorthTrend({ points }: { points: TrendPoint[] }) {
  const [range, setRange] = useState<RangeValue>('6m')
  const [showTable, setShowTable] = useState(false)

  const data = useMemo(() => {
    const months = RANGES.find((r) => r.value === range)?.months ?? null
    const cutoff = cutoffFor(months)
    const filtered = cutoff ? points.filter((p) => p.date >= cutoff) : points
    // 至少畫兩點才看得出趨勢；資料不夠就退回全部
    return filtered.length >= 2 ? filtered : points
  }, [points, range])

  const last = data.at(-1)
  const values = data.map((d) => d.netWorth)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.03, 1)

  if (points.length === 0) return null

  return (
    <section aria-labelledby="trend-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="trend-heading" className="text-base font-semibold text-ink">
          淨資產趨勢
        </h2>
        <Segmented
          aria-label="趨勢圖時間範圍"
          options={RANGES.map(({ value, label }) => ({ value, label }))}
          value={range}
          onChange={setRange}
        />
      </div>

      {points.length === 1 ? (
        <p className="py-8 text-center text-sm text-ink-muted">
          再盤點一次就會畫出趨勢線。
        </p>
      ) : (
        <>
          {/* 高度含 x 軸標籤帶，避免卡片內出現小的巢狀捲動 */}
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid
                  stroke="var(--hairline)"
                  strokeWidth={1}
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => formatDate(v, 'M/d')}
                  tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--axis)' }}
                  minTickGap={28}
                  height={28}
                />
                <YAxis
                  domain={[min - pad, max + pad]}
                  tickFormatter={formatCompactTwd}
                  tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
                <Tooltip
                  content={<TrendTooltip />}
                  cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                />
                <Line
                  type="monotone"
                  dataKey="netWorth"
                  stroke={TREND_COLOR_VAR}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
                  isAnimationActive={false}
                />
                {last && (
                  <ReferenceDot
                    x={last.date}
                    y={last.netWorth}
                    r={4}
                    fill={TREND_COLOR_VAR}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {last && (
            <p className="mt-1 text-right text-sm text-ink-2 tnum">
              最新 {formatDate(last.date, 'M/d')}：{formatTwd(last.netWorth)}
            </p>
          )}
        </>
      )}

      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        className="mt-2 text-sm text-ink-muted underline underline-offset-4"
        aria-expanded={showTable}
      >
        {showTable ? '收起數值表' : '以表格檢視數值'}
      </button>

      {showTable && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-2xl ring-1 ring-hairline">
          <table className="w-full text-sm tnum">
            <caption className="sr-only">各次盤點的資產、負債與淨資產</caption>
            <thead className="sticky top-0 bg-sunken text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">日期</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">資產</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">負債</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">淨資產</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((p) => (
                <tr key={p.date} className="border-t border-hairline">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-ink-2">
                    {formatDate(p.date, 'yyyy/M/d')}
                  </th>
                  <td className="px-3 py-2 text-right">{formatTwd(p.assets, { showPrefix: false })}</td>
                  <td className="px-3 py-2 text-right">{formatTwd(p.liabilities, { showPrefix: false })}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatTwd(p.netWorth, { showPrefix: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
