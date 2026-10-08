import { useId } from 'react'
import type { Currency } from '@shared/model'
import { cn } from '@/lib/cn'
import { formatAmountWhileTyping } from '@/lib/format'

interface AmountInputProps {
  value: string
  onChange: (value: string) => void
  currency: Currency
  label: string
  autoFocus?: boolean
  onEnter?: () => void
}

const PREFIX: Record<Currency, string> = { TWD: 'NT$', USD: 'US$' }

/**
 * 盤點用的大型金額輸入。
 * - `inputMode="decimal"` 讓 iPhone 直接跳數字鍵盤
 * - 邊打邊補千分位，一萬和十萬不會看錯
 * - 字級遠大於 16px，不會觸發 iOS 的自動縮放
 */
export function AmountInput({
  value,
  onChange,
  currency,
  label,
  autoFocus,
  onEnter,
}: AmountInputProps) {
  const id = useId()

  return (
    <div className="flex items-baseline gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span className="text-xl font-medium text-ink-muted">{PREFIX[currency]}</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="next"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(formatAmountWhileTyping(e.target.value))}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter?.()
        }}
        placeholder="0"
        className={cn(
          'min-w-0 flex-1 bg-transparent py-1 text-[2rem] leading-tight font-semibold',
          'text-ink tabular-nums placeholder:text-axis focus:outline-none',
        )}
      />
    </div>
  )
}
