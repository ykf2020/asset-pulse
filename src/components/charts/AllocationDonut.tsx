import { useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Segmented } from '@/components/ui/Segmented'
import type { Slice } from '@/lib/derive'
import { formatPercent, formatTwd } from '@/lib/format'

type Dimension = 'type' | 'currency'

const DIMENSIONS = [
  { value: 'type' as const, label: '依類型' },
  { value: 'currency' as const, label: '依幣別' },
]

interface TooltipProps {
  active?: boolean
  payload?: { payload: Slice }[]
}

function SliceTooltip({ active, payload }: TooltipProps) {
  const slice = payload?.[0]?.payload
  if (!active || !slice) return null
  return (
    <div className="rounded-xl bg-surface px-3 py-2 text-sm shadow-lg ring-1 ring-hairline">
      <p className="font-medium text-ink">{slice.label}</p>
      <p className="text-ink-2 tnum">
        {formatTwd(slice.amountTwd)}・{formatPercent(slice.share)}
      </p>
    </div>
  )
}

/**
 * 資產配置圓環。段的排列順序固定（依帳戶類型的既定順序，不依金額大小），
 * 所以同一個類型永遠是同一個顏色、同一個位置，月月之間可以直接對照。
 * 每一段在下方的圖例都有直接標註金額與佔比，顏色不是唯一的線索。
 */
export function AllocationDonut({
  byType,
  byCurrency,
  total,
}: {
  byType: Slice[]
  byCurrency: Slice[]
  total: number
}) {
  const [dimension, setDimension] = useState<Dimension>('type')
  const [showTable, setShowTable] = useState(false)

  const slices = dimension === 'type' ? byType : byCurrency
  if (slices.length === 0) return null

  return (
    <section aria-labelledby="alloc-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="alloc-heading" className="text-base font-semibold text-ink">
          資產配置
        </h2>
        <Segmented
          aria-label="資產配置的分類維度"
          options={DIMENSIONS}
          value={dimension}
          onChange={setDimension}
        />
      </div>

      {slices.length === 1 ? (
        <p className="rounded-2xl bg-sunken px-4 py-3 text-sm text-ink-2">
          目前資產全部集中在「{slices[0]!.label}」，{formatTwd(slices[0]!.amountTwd)}。
        </p>
      ) : (
        <div className="relative mx-auto h-48 w-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="amountTwd"
                nameKey="label"
                innerRadius="64%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                stroke="var(--surface)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {slices.map((slice) => (
                  <Cell key={slice.key} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip content={<SliceTooltip />} />
            </PieChart>
          </ResponsiveContainer>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs text-ink-muted">總資產</span>
            <span className="text-lg font-semibold text-ink">{formatTwd(total)}</span>
          </div>
        </div>
      )}

      {/* 圖例即直接標籤：每一段都附上金額與佔比，不靠顏色單獨辨識 */}
      <ul className="mt-4 space-y-2">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <span className="truncate text-ink-2">{slice.label}</span>
            </span>
            <span className="shrink-0 tnum">
              <span className="font-medium text-ink">{formatTwd(slice.amountTwd)}</span>
              <span className="ml-2 text-ink-muted">{formatPercent(slice.share)}</span>
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        className="mt-3 text-sm text-ink-muted underline underline-offset-4"
        aria-expanded={showTable}
      >
        {showTable ? '收起數值表' : '以表格檢視數值'}
      </button>

      {showTable && (
        <div className="mt-3 overflow-hidden rounded-2xl ring-1 ring-hairline">
          <table className="w-full text-sm tnum">
            <caption className="sr-only">資產配置金額與佔比</caption>
            <thead className="bg-sunken text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">分類</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">金額</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">佔比</th>
              </tr>
            </thead>
            <tbody>
              {slices.map((slice) => (
                <tr key={slice.key} className="border-t border-hairline">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-ink-2">
                    {slice.label}
                  </th>
                  <td className="px-3 py-2 text-right">
                    {formatTwd(slice.amountTwd, { showPrefix: false })}
                  </td>
                  <td className="px-3 py-2 text-right">{formatPercent(slice.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
