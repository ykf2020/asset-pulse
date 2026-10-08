import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_HINT,
  ACCOUNT_TYPE_LABEL,
  CURRENCIES,
  CURRENCY_LABEL,
  LIABILITY_TYPES,
  USD_DEFAULT_TYPES,
  type AccountType,
  type Currency,
} from '@shared/model'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { LoadingBlock, Notice } from '@/components/ui/Feedback'
import { Field, SelectInput, TextInput, ToggleRow } from '@/components/ui/Field'
import { useData } from '@/hooks/useData'
import { useCreateAccount, useRemoveAccount, useUpdateAccount } from '@/hooks/useMutations'

export function AccountEdit() {
  const { id } = useParams<{ id: string }>()
  const isNew = id === undefined
  const navigate = useNavigate()
  const { data } = useData()

  const existing = isNew ? undefined : data?.accounts.find((a) => a.id === id)
  const hasHistory = Boolean(id && data?.snapshots.some((s) => s.account_id === id))

  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('bank')
  const [currency, setCurrency] = useState<Currency>('TWD')
  const [institution, setInstitution] = useState('')
  const [isLiability, setIsLiability] = useState(false)
  const [note, setNote] = useState('')
  const [touchedCurrency, setTouchedCurrency] = useState(false)
  const [touchedLiability, setTouchedLiability] = useState(false)

  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setType(existing.type)
    setCurrency(existing.currency)
    setInstitution(existing.institution)
    setIsLiability(existing.is_liability)
    setNote(existing.note)
  }, [existing])

  // 新建時依類型給出合理預設，使用者動過就不再自動覆蓋
  function changeType(next: AccountType) {
    setType(next)
    if (!isNew) return
    if (!touchedCurrency) setCurrency(USD_DEFAULT_TYPES.includes(next) ? 'USD' : 'TWD')
    if (!touchedLiability) setIsLiability(LIABILITY_TYPES.includes(next))
  }

  const create = useCreateAccount()
  const update = useUpdateAccount()
  const remove = useRemoveAccount()
  const busy = create.isPending || update.isPending || remove.isPending
  const error = (create.error ?? update.error ?? remove.error) as Error | undefined

  if (!isNew && !data) return <LoadingBlock />
  if (!isNew && data && !existing) {
    return (
      <div className="px-5 py-10">
        <Notice tone="error" title="找不到這個帳戶" />
      </div>
    )
  }

  async function save() {
    const payload = {
      name: name.trim(),
      type,
      currency,
      institution: institution.trim(),
      is_liability: isLiability,
      note: note.trim(),
    }
    if (isNew) await create.mutateAsync(payload)
    else await update.mutateAsync({ id: id!, patch: payload })
    navigate('/accounts')
  }

  async function handleRemove() {
    const message = hasHistory
      ? `「${name}」已經有盤點紀錄，會改為封存（歷史保留，之後盤點不再出現）。確定嗎？`
      : `確定要刪除「${name}」嗎？`
    if (!window.confirm(message)) return
    await remove.mutateAsync(id!)
    navigate('/accounts')
  }

  return (
    <div className="pb-8">
      <PageHeader title={isNew ? '新增帳戶' : '編輯帳戶'} back="/accounts" />

      <div className="space-y-4 px-4">
        <Card className="space-y-4">
          <Field label="帳戶名稱" hint="例如「玉山數位帳戶」「Pionex」「台新信貸」">
            {(fieldId) => (
              <TextInput
                id={fieldId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="輸入好認的名字"
                autoFocus={isNew}
                enterKeyHint="done"
              />
            )}
          </Field>

          <Field label="類型" hint={ACCOUNT_TYPE_HINT[type]}>
            {(fieldId) => (
              <SelectInput
                id={fieldId}
                value={type}
                onChange={(e) => changeType(e.target.value as AccountType)}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABEL[t]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>

          <Field
            label="計價幣別"
            hint={
              hasHistory
                ? '已經有盤點紀錄，幣別不能再改（否則舊資料會被用錯匯率解讀）'
                : currency === 'USD'
                  ? '盤點時填美元金額，系統會用當次匯率換算台幣'
                  : undefined
            }
          >
            {(fieldId) => (
              <SelectInput
                id={fieldId}
                value={currency}
                disabled={hasHistory}
                onChange={(e) => {
                  setTouchedCurrency(true)
                  setCurrency(e.target.value as Currency)
                }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {CURRENCY_LABEL[c]}（{c}）
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>

          <Field label="機構（選填）">
            {(fieldId) => (
              <TextInput
                id={fieldId}
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="玉山銀行 / 元大期貨 / Binance"
              />
            )}
          </Field>

          <ToggleRow
            label="這是負債"
            description="打開後，金額會從淨資產裡扣除。填寫時一樣填正數的剩餘本金。"
            checked={isLiability}
            onChange={(v) => {
              setTouchedLiability(true)
              setIsLiability(v)
            }}
          />

          <Field label="備註（選填）">
            {(fieldId) => (
              <TextInput
                id={fieldId}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="利率 2.8%、84 期…"
              />
            )}
          </Field>
        </Card>

        {error && <Notice tone="error">{error.message}</Notice>}

        <Button block size="lg" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
          {isNew ? '建立帳戶' : '儲存變更'}
        </Button>

        {!isNew && (
          <Button
            block
            variant="ghost"
            className="text-critical"
            icon={<Trash2 className="size-5" />}
            disabled={busy}
            onClick={() => void handleRemove()}
          >
            {hasHistory ? '封存這個帳戶' : '刪除這個帳戶'}
          </Button>
        )}
      </div>
    </div>
  )
}
