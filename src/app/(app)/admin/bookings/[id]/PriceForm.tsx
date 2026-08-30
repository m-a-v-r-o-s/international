'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { adminSetBookingPrice, type FormState } from '../actions'

/**
 * A5 · Price amendment (docs/01-DECISIONS.md §6). The only path is
 * admin_set_booking_price() — total_cents is not in the update column grant
 * even for admin — and every call is audit-logged by the same trigger as any
 * other write, so this screen adds no logging of its own.
 */
export function PriceForm({ bookingId, totalCents }: { bookingId: string; totalCents: number | null }) {
  const t = useTranslations('admin.bookings')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<FormState, FormData>(async (_prev, formData) => {
    const euros = formData.get('total_euros')
    formData.set('total_cents', String(Math.round(Number.parseFloat(String(euros || '0')) * 100)))
    return adminSetBookingPrice(_prev, formData)
  }, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={bookingId} />

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}

      <Field
        id="total_euros" name="total_euros" type="number" min={0} step={0.01} inputMode="decimal"
        label={t('newPrice')}
        defaultValue={totalCents !== null ? (totalCents / 100).toFixed(2) : undefined}
        required
      />

      <SubmitButton label={tc('save')} variant="quiet" />
      {state && !state.error ? <p className="text-[0.875rem] text-ok">{t('priceSaved')}</p> : null}
    </form>
  )
}
