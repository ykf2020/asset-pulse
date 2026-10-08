import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { Delta } from '@shared/money'
import { cn } from '@/lib/cn'
import { formatPercent, formatSignedTwd } from '@/lib/format'

interface DeltaBadgeProps {
  delta: Delta
  /** 負債增加是壞事、資產增加是好事 —— 這個旗標把方向反過來解讀 */
  invert?: boolean
  showPercent?: boolean
  size?: 'sm' | 'md'
  className?: string
}

/**
 * 漲跌同時用「箭頭 + 正負號 + 顏色」三重編碼，不讓顏色單獨承擔意義
 * （色弱、單色列印、強制對比模式下都還讀得懂）。
 */
export function DeltaBadge({
  delta,
  invert = false,
  showPercent = true,
  size = 'md',
  className,
}: DeltaBadgeProps) {
  const { absolute, percent } = delta
  const flat = Math.round(absolute) === 0
  const rising = absolute > 0
  const good = invert ? !rising : rising

  const Icon = flat ? Minus : rising ? ArrowUpRight : ArrowDownRight
  const tone = flat ? 'text-ink-muted' : good ? 'text-up' : 'text-down'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium tnum',
        size === 'sm' ? 'text-sm' : 'text-base',
        tone,
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'size-4' : 'size-[18px]'} aria-hidden />
      {flat ? '持平' : formatSignedTwd(absolute)}
      {showPercent && !flat && percent !== null && (
        <span className="text-ink-muted">（{formatPercent(percent)}）</span>
      )}
    </span>
  )
}
