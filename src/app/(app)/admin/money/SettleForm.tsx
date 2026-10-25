'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { settlePayAfter, type FormState } from './actions'

/** A14 · One way of settling one balance. Gratis asks first: it cannot be undone. */
export function SettleForm({
  bookingId, outcome, method, label, confirmText,
}: {
  bookingId: string
  outcome: 'paid' | 'gratis'
  method?: 'cash' | 'card'
  label: string
  confirmText?: string
}) {
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<FormState, FormData>(settlePayAfter, undefined)

  return (
    <form
      action={formAction}
      onSubmit={(e) => { if (confirmText && !confirm(confirmText)) e.preventDefault() }}
      className="flex flex-col gap-1"
    >
      <input type="hidden" name="booking_id" value={bookingId} />
      <input type="hidden" name="outcome" value={outcome} />
      {method ? <input type="hidden" name="method" value={method} /> : null}
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger !py-1.5 !text-[0.8125rem]" role="alert">
          {te(state.error)}
        </p>
      ) : null}
      <SubmitButton label={label} variant="quiet" />
    </form>
  )
}
