'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { restoreDeleted, type SettingsState } from '../actions'

export function RestoreForm({ id }: { id: number }) {
  const t = useTranslations('adminSettings')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<SettingsState, FormData>(restoreDeleted, undefined)

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={id} />
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}
      <SubmitButton label={t('binRestore')} variant="quiet" />
    </form>
  )
}
