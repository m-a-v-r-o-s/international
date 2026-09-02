'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { FormActions } from '@/components/FormActions'
import { updateBooking, type FormState } from '../actions'
import type { BookingRow } from '@/lib/supabase/database.types'

type Hotel = { id: string; name: string; area: string | null }

export function EditBookingForm({
  booking, hotels,
}: {
  booking: Pick<BookingRow, 'id' | 'hotel_id' | 'room_number' | 'start_date' | 'end_date'
    | 'cust_first' | 'cust_last' | 'cust_phone' | 'cust_dob'>
  hotels: Hotel[]
}) {
  const t = useTranslations('bookingDetail')
  const tn = useTranslations('newBooking')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<FormState, FormData>(updateBooking, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={booking.id} />

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field id="start_date" name="start_date" type="date" label={tn('pickupDate')} defaultValue={booking.start_date} required />
        <Field id="end_date" name="end_date" type="date" label={tn('returnDate')} defaultValue={booking.end_date} required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="ir-label" htmlFor="hotel_id">{tn('hotel')}</label>
          <select id="hotel_id" name="hotel_id" className="ir-field" required defaultValue={booking.hotel_id ?? ''}>
            {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <Field id="room_number" name="room_number" label={tn('room')} defaultValue={booking.room_number ?? undefined} maxLength={16} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field id="cust_first" name="cust_first" label={tn('firstName')} defaultValue={booking.cust_first ?? undefined} required maxLength={80} />
        <Field id="cust_last" name="cust_last" label={tn('lastName')} defaultValue={booking.cust_last ?? undefined} required maxLength={80} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field id="cust_phone" name="cust_phone" type="tel" label={tn('phone')} defaultValue={booking.cust_phone ?? undefined} required maxLength={32} />
        <Field id="cust_dob" name="cust_dob" type="date" label={tn('dob')} defaultValue={booking.cust_dob ?? undefined} required />
      </div>

      <FormActions label={tc('save')} variant="quiet" saved={state && !state.error} />
      {state && !state.error ? <p className="text-[0.875rem] text-ok">{t('saved')}</p> : null}
    </form>
  )
}
