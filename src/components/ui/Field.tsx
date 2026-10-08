import * as Label from '@radix-ui/react-label'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useId } from 'react'
import { cn } from '@/lib/cn'

const controlClass =
  'w-full rounded-2xl bg-sunken px-4 py-3 text-ink ring-1 ring-hairline ' +
  'placeholder:text-ink-muted focus:outline-2 focus:outline-offset-0 focus:outline-brand ' +
  'disabled:opacity-60'

interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: (id: string) => ReactNode
  className?: string
}

export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId()
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label.Root htmlFor={id} className="block text-sm font-medium text-ink-2">
        {label}
      </Label.Root>
      {children(id)}
      {error ? (
        <p className="text-sm text-critical">{error}</p>
      ) : hint ? (
        <p className="text-sm text-ink-muted">{hint}</p>
      ) : null}
    </div>
  )
}

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClass, className)} {...props} />
}

export function SelectInput({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(controlClass, 'appearance-none pr-10', className)} {...props}>
      {children}
    </select>
  )
}

interface ToggleRowProps {
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function ToggleRow({ label, description, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-sunken px-4 py-3 ring-1 ring-hairline',
        disabled && 'opacity-60',
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-ink-muted">{description}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="size-6 shrink-0 accent-[var(--brand)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}
