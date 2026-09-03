'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { FormActions } from '@/components/FormActions'
import { HotelLocationField } from '@/components/HotelLocationField'
import { adminUpdateBooking, type FormState } from '../actions'
import type { BookingRow } from '@/lib/supabase/database.types'

type Hotel = { id: string; name: string; area: string | null }
type Car = { id: string; plate: string; model_id: string }

export function AdminEditBookingForm({
  booking, hotels, cars,
}: {
  booking: Pick<BookingRow, 'id' | 'car_id' | 'hotel_id' | 'adhoc_hotel_name' | 'room_number' | 'start_date' | 'end_date'
    | 'cust_first' | 'cust_last' | 'cust_phone' | 'cust_dob' | 'status'
    | 'collected' | 'pay_method' | 'paid'>
  hotels: Hotel[]
  cars: Car[]
}) {
  const t = useTranslations('admin.bookings')
  const tb = useTranslations('bookingDetail')
  const tn = useTranslations('newBooking')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<FormState, FormData>(adminUpdateBooking, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={booking.id} />

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}

      <div>
        <label className="ir-label" htmlFor="car_id">{tb('car')}</label>
        <select id="car_id" name="car_id" className="ir-field" required defaultValue={booking.car_id}>
          {cars.map((c) => <option key={c.id} value={c.id}>{c.plate}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field id="start_date" name="start_date" type="date" label={tn('pickupDate')} defaultValue={booking.start_date} required />
        <Field id="end_date" name="end_date" type="date" label={tn('returnDate')} defaultValue={booking.end_date} required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <HotelLocationField
          hotels={hotels} defaultHotelId={booking.hotel_id} defaultAdhocHotelName={booking.adhoc_hotel_name}
          label={tn('hotel')} chooseLabel={tn('chooseHotel')} otherLabel={tn('otherHotel')}
          otherNameLabel={tn('otherHotelName')} required={false} allowNone noneLabel="–"
        />
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

      <div>
        <label className="ir-label" htmlFor="status">{t('statusLabel')}</label>
        <select id="status" name="status" className="ir-field" required defaultValue={booking.status}>
          <option value="booked">{tb('status.booked')}</option>
          <option value="out">{tb('status.out')}</option>
          <option value="returned">{tb('status.returned')}</option>
          <option value="cancelled">{tb('status.cancelled')}</option>
          <option value="no_show">{tb('status.no_show')}</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field
          id="collected" name="collected" type="number" min={0} step={1} inputMode="numeric"
          label={t('collected')} defaultValue={booking.collected}
        />
        <div>
          <label className="ir-label" htmlFor="pay_method">{t('payMethod')}</label>
          <select id="pay_method" name="pay_method" className="ir-field" defaultValue={booking.pay_method ?? ''}>
            <option value="">–</option>
            <option value="cash">{t('payMethodCash')}</option>
            <option value="card">{t('payMethodCard')}</option>
            <option value="transfer">{t('payMethodTransfer')}</option>
          </select>
        </div>
      </div>

      <label className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
        <input type="checkbox" name="paid" defaultChecked={booking.paid} className="size-5" />
        {tb('paid')}
      </label>

      <FormActions label={tc('save')} variant="quiet" saved={state && !state.error} />
      {state && !state.error ? <p className="text-[0.875rem] text-ok">{tb('saved')}</p> : null}
    </form>
  )
}
