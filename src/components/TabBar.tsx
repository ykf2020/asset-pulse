import { History, PieChart, Settings as SettingsIcon, Wallet } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/cn'

const TABS = [
  { to: '/', label: '首頁', icon: PieChart, end: true },
  { to: '/accounts', label: '帳戶', icon: Wallet, end: false },
  { to: '/history', label: '歷史', icon: History, end: false },
  { to: '/settings', label: '設定', icon: SettingsIcon, end: false },
] as const

export function TabBar() {
  return (
    <nav
      aria-label="主要導覽"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 safe-bottom',
        'border-t border-hairline bg-surface/85 backdrop-blur-xl',
      )}
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-[11px] font-medium',
                  isActive ? 'text-brand' : 'text-ink-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="size-6" strokeWidth={isActive ? 2.4 : 1.8} aria-hidden />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
