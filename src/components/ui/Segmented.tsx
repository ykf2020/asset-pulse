import { cn } from '@/lib/cn'

interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  'aria-label': string
  className?: string
}

/** iOS 風格的分段控制，用於切換時間範圍、圖表維度 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex gap-1 rounded-2xl bg-sunken p-1 ring-1 ring-hairline', className)}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-9 rounded-xl px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
              selected ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-ink-muted',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
