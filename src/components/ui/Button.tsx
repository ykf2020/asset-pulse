import { Slot, Slottable } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-2xl font-medium ' +
    'transition-[background-color,opacity,transform] active:scale-[0.98] ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ' +
    'disabled:pointer-events-none disabled:opacity-50 select-none',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-ink',
        secondary: 'bg-sunken text-ink ring-1 ring-hairline',
        ghost: 'text-ink-2 hover:bg-sunken',
        danger: 'bg-critical text-white',
      },
      size: {
        // 觸控目標一律 >= 44px 高
        md: 'h-12 px-5 text-base',
        lg: 'h-14 px-6 text-lg',
        sm: 'h-11 px-4 text-sm',
        icon: 'size-11',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  className,
  variant,
  size,
  block,
  asChild,
  loading,
  icon,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      className={cn(button({ variant, size, block }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : icon}
      {/* asChild 時 Slot 只接受單一元素子節點，用 Slottable 標出哪一個才是它要套上去的 */}
      <Slottable>{children}</Slottable>
    </Comp>
  )
}
