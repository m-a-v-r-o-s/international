'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { approveExceptionBooking, denyExceptionBooking, type FormState } from './actions'

/** One row's Approve/Deny — see docs/01-DECISIONS.md, "Exception bookings wait for the boss". */
export function ExceptionBookingActions({ bookingId }: { bookingId: string }) {
  const t = useTranslations('admin.exceptionBookings')
  const te = useTranslations('errors')
  const router = useRouter()

  const [approveState, approveAction] = useActionState<FormState, FormData>(async (prev, fd) => {
    const result = await approveExceptionBooking(prev, fd)
    if (!result?.error) router.refresh()
    return result
  }, undefined)

  const [denyState, denyAction] = useActionState<FormState, FormData>(async (prev, fd) => {
    const result = await denyExceptionBooking(prev, fd)
    if (!result?.error) router.refresh()
    return result
  }, undefined)

  const error = approveState?.error ?? denyState?.error

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(error)}</p>
      ) : null}
      <form action={approveAction}>
        <input type="hidden" name="booking_id" value={bookingId} />
        <SubmitButton label={t('approve')} />
      </form>
      <form action={denyAction} onSubmit={(e) => { if (!confirm(t('denyConfirm'))) e.preventDefault() }}>
        <input type="hidden" name="booking_id" value={bookingId} />
        <SubmitButton label={t('deny')} variant="quiet" />
      </form>
    </div>
  )
}
