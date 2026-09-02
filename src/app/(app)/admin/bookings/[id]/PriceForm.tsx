'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { FormActions } from '@/components/FormActions'
import { adminSetBookingPrice, type FormState } from '../actions'

/**
 * A5 · Price amendment (docs/01-DECISIONS.md §6). The only path is
 * admin_set_booking_price() — total is not in the update column grant
 * even for admin — and every call is audit-logged by the same trigger as any
 * other write, so this screen adds no logging of its own.
 */
export function PriceForm({ bookingId, total }: { bookingId: string; total: number | null }) {
  const t = useTranslations('admin.bookings')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<FormState, FormData>(adminSetBookingPrice, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={bookingId} />

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}

      <Field
        id="total" name="total" type="number" min={0} step={1} inputMode="numeric"
        label={t('newPrice')}
        defaultValue={total ?? undefined}
        required
      />

      <FormActions label={tc('save')} variant="quiet" saved={state && !state.error} />
      {state && !state.error ? <p className="text-[0.875rem] text-ok">{t('priceSaved')}</p> : null}
    </form>
  )
}
