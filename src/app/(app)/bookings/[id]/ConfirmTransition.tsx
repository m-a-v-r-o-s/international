'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import type { HandoverState } from '@/lib/handover/fuel'

/**
 * The one button that moves a booking between statuses — booked → out at the
 * end of R4, out → returned at the end of R5.
 *
 * It sends the transition and reports what the database said. Every rule that
 * could stop it (the eligibility gate, the closed-booking guard, the exclusion
 * constraint) is enforced in Postgres, so there is nothing here to skip and
 * nothing here that could drift out of step with the guard trigger.
 */
export function ConfirmTransition({
  bookingId, action, label, confirmMessage,
}: {
  bookingId: string
  action: (prev: HandoverState, formData: FormData) => Promise<HandoverState>
  label: string
  confirmMessage: string
}) {
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<HandoverState, FormData>(action, undefined)

  return (
    <form
      action={formAction}
      onSubmit={(e) => { if (!window.confirm(confirmMessage)) e.preventDefault() }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="booking_id" value={bookingId} />
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}
      <SubmitButton label={label} />
    </form>
  )
}
