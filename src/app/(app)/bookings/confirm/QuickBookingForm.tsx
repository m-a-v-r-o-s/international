'use client'

import { useActionState, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { SEAT_TYPES, type QuickBookingNext } from '@/lib/bookings/quick'
import { createQuickBooking, type QuickBookingState } from './actions'
import {
  previewBookingQuote, lookupCustomer,
  type QuoteState, type CustomerLookupState,
} from '../new/actions'
import type { CarWithSpecs } from '@/lib/availability/types'
import type { BookingWindows, Hotel } from '@/lib/bookings/types'

/**
 * R3b · Booking confirmation (docs/04-SCREENS.md, docs/01-DECISIONS.md §30).
 *
 * The form a rep fills in with a phone against their ear. Five things and
 * nothing else: the number, the room, the car, the dates, the seats — plus an
 * optional name, which is the one field the owner did not ask for and which is
 * here because R1 and A1 print a guest name per row and would otherwise print
 * a blank until pickup. It is never required.
 *
 * Two screens render it. From the header it confirms a booking and stops. From
 * the walk-in path (`next="pickup"`) it confirms and continues straight into
 * licence capture, which is the same journey with no pause in the middle.
 */
export function QuickBookingForm({
  cars, hotels, defaultHotelId, windows, next, defaultFrom, defaultTo,
  pickupTimeDefault, submitLabel,
}: {
  cars: CarWithSpecs[]
  hotels: Hotel[]
  defaultHotelId?: string
  windows: BookingWindows
  next: QuickBookingNext
  defaultFrom?: string
  defaultTo?: string
  /** Overrides the window's opening time — the walk-in is here now. */
  pickupTimeDefault?: string
  submitLabel: string
}) {
  const t = useTranslations('quickBooking')
  const tn = useTranslations('newBooking')
  const tc = useTranslations('common')
  const te = useTranslations('errors')

  const [carId, setCarId] = useState('')
  const [start, setStart] = useState(defaultFrom ?? '')
  const [end, setEnd] = useState(defaultTo ?? '')
  const [seats, setSeats] = useState<Set<typeof SEAT_TYPES[number]>>(new Set())

  const selectedCar = cars.find((c) => c.id === carId) ?? null
  const validDates = Boolean(start && end && end >= start)

  const [quote, previewAction, previewPending] = useActionState<QuoteState, FormData>(
    previewBookingQuote, undefined)

  // The price is asked for on the call — "how much is that?" is the next thing
  // the guest says — so the same server quote R3 shows is shown here. Read
  // only, computed by public.quote(), never by this component (§6).
  useEffect(() => {
    if (!selectedCar || !start || !end || end < start) return
    const fd = new FormData()
    fd.set('category_id', selectedCar.category_id)
    fd.set('start', start)
    fd.set('end', end)
    const timer = setTimeout(() => previewAction(fd), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCar?.category_id, start, end])

  // ── The returning guest (docs/01-DECISIONS.md §25a) ──────────────────────
  // The same lookup R3 runs, on the same blur, for the same reason: a rep who
  // types a number that the ledger already knows should not be asked for a
  // name they have given before. It fills the optional name field and nothing
  // else — this form has no date of birth to fill.
  const [phone, setPhone] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [askedFor, setAskedFor] = useState<string | null>(null)

  const [lookup, lookupAction] = useActionState<CustomerLookupState, FormData>(
    lookupCustomer, undefined)

  useEffect(() => {
    const match = lookup?.status === 'found' ? lookup.match : null
    if (!match) return
    setFirst((v) => v || match.firstName || '')
    setLast((v) => v || match.lastName || '')
  }, [lookup])

  const askLedger = () => {
    const trimmed = phone.trim()
    if (trimmed.length < 4 || trimmed === askedFor) return
    setAskedFor(trimmed)
    const fd = new FormData()
    fd.set('cust_phone', trimmed)
    lookupAction(fd)
  }

  const [state, formAction] = useActionState<QuickBookingState, FormData>(
    createQuickBooking, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="next" value={next} />

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
          {te(state.error)}
        </p>
      ) : null}

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('guestTitle')}</h2>
        <Field
          id="cust_phone" name="cust_phone" type="tel" label={tn('phone')} required maxLength={32}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={askLedger}
          hint={tn('phoneHint')}
        />

        {lookup?.status === 'found' && lookup.match ? (
          <p className="ir-notice border-brand bg-brand-tint mt-3" role="status">
            {tn('returningGuest', {
              name: `${lookup.match.firstName ?? ''} ${lookup.match.lastName ?? ''}`.trim() || '—',
            })}
          </p>
        ) : null}
        {lookup?.status === 'error' ? (
          <p className="ir-notice border-warn bg-warn-tint text-warn mt-3" role="status">
            {te(lookup.error ?? 'unknown')}
          </p>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field
            id="cust_first" name="cust_first" label={tn('firstName')} maxLength={80}
            value={first} onChange={(e) => setFirst(e.target.value)}
          />
          <Field
            id="cust_last" name="cust_last" label={tn('lastName')} maxLength={80}
            value={last} onChange={(e) => setLast(e.target.value)}
          />
        </div>
        <p className="ir-hint mt-1">{t('nameOptional')}</p>
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{tn('hotelTitle')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ir-label" htmlFor="hotel_id">{tn('hotel')}</label>
            <select id="hotel_id" name="hotel_id" className="ir-field" required defaultValue={defaultHotelId}>
              <option value="" disabled>{tn('chooseHotel')}</option>
              {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <Field id="room_number" name="room_number" label={tn('room')} maxLength={16} />
        </div>
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{tn('carTitle')}</h2>
        <label className="ir-label" htmlFor="car_id">{tn('chooseCar')}</label>
        <select
          id="car_id" name="car_id" className="ir-field" value={carId}
          onChange={(e) => setCarId(e.target.value)} required
        >
          <option value="" disabled>{tn('chooseCarPlaceholder')}</option>
          {cars.map((c) => (
            <option key={c.id} value={c.id}>{c.plate} — {c.make} {c.model} ({c.category_code})</option>
          ))}
        </select>
        <p className="ir-hint">{t('carHint')}</p>
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{tn('datesTitle')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ir-label" htmlFor="start_date">{tn('pickupDate')}</label>
            <input
              id="start_date" name="start_date" type="date" className="ir-field" required
              value={start} onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <label className="ir-label" htmlFor="end_date">{tn('returnDate')}</label>
            <input
              id="end_date" name="end_date" type="date" className="ir-field" required
              value={end} onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
        {/*
          The times are the admin's default windows (§5), filled in and left
          visible rather than posted invisibly. A phone booking that recorded
          nothing would sort as a blank on the boss's morning sheet, and a
          hidden field that silently sets data is worse than a shown one the
          rep can correct.
        */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="ir-label" htmlFor="pickup_time">{tn('pickupTime')}</label>
            <input
              id="pickup_time" name="pickup_time" type="time" className="ir-field"
              defaultValue={pickupTimeDefault ?? windows.pickupFrom}
              aria-describedby="pickup_time_hint"
            />
            <p className="ir-hint" id="pickup_time_hint">
              {tn('windowHint', { from: windows.pickupFrom, to: windows.pickupTo })}
            </p>
          </div>
          <div>
            <label className="ir-label" htmlFor="dropoff_time">{tn('dropoffTime')}</label>
            <input
              id="dropoff_time" name="dropoff_time" type="time" className="ir-field"
              defaultValue={windows.dropoffFrom} aria-describedby="dropoff_time_hint"
            />
            <p className="ir-hint" id="dropoff_time_hint">
              {tn('windowHint', { from: windows.dropoffFrom, to: windows.dropoffTo })}
            </p>
          </div>
        </div>
        {!validDates && start && end ? (
          <p className="ir-error mt-2" role="alert">
            <span aria-hidden="true">!</span>{te('IR104')}
          </p>
        ) : null}
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('seatsTitle')}</h2>
        <p className="mb-2 text-[0.875rem] text-ink-soft">{tn('extrasHint')}</p>
        <div className="flex flex-col gap-2">
          {SEAT_TYPES.map((seat) => (
            <label key={seat} className="flex min-h-11 items-center gap-2.5 text-[1.0625rem] text-ink">
              <input
                type="checkbox" name="seat" value={seat}
                checked={seats.has(seat)}
                onChange={(e) => {
                  setSeats((prev) => {
                    const nextSeats = new Set(prev)
                    if (e.target.checked) nextSeats.add(seat); else nextSeats.delete(seat)
                    return nextSeats
                  })
                }}
                className="size-5 rounded border-control"
              />
              {tn(`seat.${seat}`)}
            </label>
          ))}
        </div>
      </section>

      <section className="ir-card p-4" aria-live="polite">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{tn('priceTitle')}</h2>
        {!selectedCar || !validDates ? (
          <p className="text-ink-soft">{tn('priceNeedsCarAndDates')}</p>
        ) : previewPending ? (
          <p className="text-ink-soft">{tc('loading')}</p>
        ) : quote?.error ? (
          <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(quote.error)}</p>
        ) : quote?.totalCents !== undefined ? (
          <p className="text-[1.25rem] font-semibold">
            {tn('priceBreakdown', { days: quote.days ?? 0 })}
            <span className="ml-2 text-brand">€{(quote.totalCents / 100).toFixed(2)}</span>
          </p>
        ) : (
          <p className="text-ink-soft">{tc('loading')}</p>
        )}
      </section>

      <SubmitButton label={submitLabel} />
    </form>
  )
}
