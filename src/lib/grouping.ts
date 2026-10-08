import { ACCOUNT_TYPE_LABEL, type AccountType } from '@shared/model'
import type { AccountView } from './derive'
import { TYPE_CHART_ORDER } from './palette'

export interface AccountGroup {
  key: string
  label: string
  items: AccountView[]
}

/**
 * 依類型分組，順序沿用 ACCOUNT_TYPES（流動性由高到低），負債自成一組擺最後。
 * 帳戶一多就得靠分組才掃得動。
 */
export function groupAccounts(views: readonly AccountView[]): AccountGroup[] {
  const liabilities = views.filter((v) => v.account.is_liability)
  const assets = views.filter((v) => !v.account.is_liability)

  const groups: AccountGroup[] = []
  for (const type of TYPE_CHART_ORDER) {
    const items = assets.filter((v) => v.account.type === type)
    if (items.length > 0) {
      groups.push({ key: type, label: ACCOUNT_TYPE_LABEL[type as AccountType], items })
    }
  }
  if (liabilities.length > 0) {
    groups.push({ key: 'liabilities', label: '負債', items: liabilities })
  }
  return groups
}
