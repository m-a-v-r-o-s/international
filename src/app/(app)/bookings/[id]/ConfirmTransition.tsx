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
 *
 * `children` is anything that has to travel WITH the transition rather than
 * before it — the return's fuel payment (0031), which is one tap with the
 * confirm because the rep takes the money and hands back the keys in the same
 * movement, and because a payment recorded by a separate button is a payment
 * that can be recorded and then not confirmed.
 */
export function ConfirmTransition({
  bookingId, action, label, confirmMessage, children,
}: {
  bookingId: string
  action: (prev: HandoverState, formData: FormData) => Promise<HandoverState>
  label: string
  confirmMessage: string
  children?: React.ReactNode
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
      {children}
      <SubmitButton label={label} />
    </form>
  )
}
