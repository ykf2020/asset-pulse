import { Archive, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ACCOUNT_TYPE_LABEL, type AccountType } from '@shared/model'
import { AccountRow } from '@/components/AccountRow'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { useOverview } from '@/hooks/useData'
import type { AccountView } from '@/lib/derive'
import { TYPE_CHART_ORDER } from '@/lib/palette'

/** 負債自成一組擺最後，其餘按類型的既定順序分組 */
function groupAccounts(views: AccountView[]): { label: string; items: AccountView[] }[] {
  const liabilities = views.filter((v) => v.account.is_liability)
  const assets = views.filter((v) => !v.account.is_liability)

  const groups: { label: string; items: AccountView[] }[] = []
  for (const type of TYPE_CHART_ORDER) {
    const items = assets.filter((v) => v.account.type === type)
    if (items.length) groups.push({ label: ACCOUNT_TYPE_LABEL[type as AccountType], items })
  }
  if (liabilities.length) groups.push({ label: '負債', items: liabilities })
  return groups
}

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
