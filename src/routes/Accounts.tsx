import { Archive, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AccountRow } from '@/components/AccountRow'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { useOverview } from '@/hooks/useData'
import { groupAccounts } from '@/lib/grouping'

export function Accounts() {
  const { overview } = useOverview()
  const [showArchived, setShowArchived] = useState(false)

  if (!overview) return <LoadingBlock />

  const groups = groupAccounts(overview.accounts)

  return (
    <div className="pb-6">
      <PageHeader
        title="帳戶"
        subtitle={`${overview.accounts.length} 個使用中`}
        action={
          <Button asChild size="sm" variant="secondary" icon={<Plus className="size-5" />}>
            <Link to="/accounts/new">新增</Link>
          </Button>
        }
      />

      {groups.length === 0 ? (
        <EmptyState
          title="還沒有任何帳戶"
          description="先把你要追蹤的銀行、期貨戶、交易所與貸款建起來。"
          action={
            <Button asChild icon={<Plus className="size-5" />}>
              <Link to="/accounts/new">新增帳戶</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4 px-4">
          {groups.map((group) => (
            <section key={group.label}>
              <h2 className="mb-1.5 px-1 text-sm font-medium text-ink-muted">{group.label}</h2>
              <Card className="p-0">
                <ul className="divide-y divide-hairline">
                  {group.items.map((view) => (
                    <li key={view.account.id}>
                      <AccountRow view={view} href={`/accounts/${view.account.id}`} />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}

          {overview.archived.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                aria-expanded={showArchived}
                className="flex items-center gap-1.5 px-1 py-2 text-sm text-ink-muted"
              >
                <Archive className="size-4" aria-hidden />
                已封存（{overview.archived.length}）
              </button>
              {showArchived && (
                <Card className="p-0 opacity-70">
                  <ul className="divide-y divide-hairline">
                    {overview.archived.map((view) => (
                      <li key={view.account.id}>
                        <AccountRow
                          view={view}
                          href={`/accounts/${view.account.id}`}
                          showDelta={false}
                        />
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
