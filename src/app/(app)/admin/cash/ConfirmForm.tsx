'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { confirmCashHandover, type FormState } from './actions'

/** A12 · One rep's pending receipt, confirmed on its own — see actions.ts. */
export function ConfirmForm({ id }: { id: string }) {
  const t = useTranslations('admin.cash')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<FormState, FormData>(confirmCashHandover, undefined)

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={id} />
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger !py-1.5 !text-[0.8125rem]" role="alert">
          {te(state.error)}
        </p>
      ) : null}
      <SubmitButton label={t('confirm')} variant="quiet" />
    </form>
  )
}
