'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { cancelBooking, type FormState } from '../actions'

export function CancelForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations('bookingDetail')
  const te = useTranslations('errors')
  const router = useRouter()
  const [state, formAction] = useActionState<FormState, FormData>(async (prev, fd) => {
    const result = await cancelBooking(prev, fd)
    if (!result?.error) router.refresh()
    return result
  }, undefined)

  return (
    <form
      action={formAction}
      onSubmit={(e) => { if (!confirm(t('cancelConfirm'))) e.preventDefault() }}
    >
      <input type="hidden" name="id" value={bookingId} />
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger mb-3" role="alert">{te(state.error)}</p>
      ) : null}
      <SubmitButton label={t('cancelAction')} variant="quiet" />
    </form>
  )
}
