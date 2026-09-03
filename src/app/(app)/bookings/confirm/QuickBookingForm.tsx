'use client'

import { useActionState, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { HotelLocationField } from '@/components/HotelLocationField'
import { SubmitButton } from '@/components/SubmitButton'
import { MAX_SEAT_QTY, SEAT_TYPES, type QuickBookingNext, type SeatType } from '@/lib/bookings/quick'
import { createQuickBooking, type QuickBookingState } from './actions'
import {
  previewBookingQuote, lookupCustomer,
  type QuoteState, type CustomerLookupState,
} from '../new/actions'
import type { CarWithSpecs } from '@/lib/availability/types'
import type { BookingWindows, Hotel } from '@/lib/bookings/types'
import { formatEuros } from '@/lib/money'

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
  pickupTimeDefault, submitLabel, isAdmin,
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
  /** As on R3: only the boss may record an exception (docs/01-DECISIONS.md §37). */
  isAdmin: boolean
}) {
  const t = useTranslations('quickBooking')
  const tn = useTranslations('newBooking')
  const tc = useTranslations('common')
  const te = useTranslations('errors')

  const [carId, setCarId] = useState('')
  const [start, setStart] = useState(defaultFrom ?? '')
  const [end, setEnd] = useState(defaultTo ?? '')
  const [seatQty, setSeatQty] = useState<Record<SeatType, number>>({ infant: 0, child: 0, booster: 0 })
  const [pickupException, setPickupException] = useState(false)

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
          id="cust_phone" name="cust_phone" type="tel" label={`${tn('phone')} *`} required maxLength={32}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={askLedger}
        />

        {lookup?.status === 'found' && lookup.match ? (
          <p className="ir-notice border-brand bg-brand-tint mt-3" role="status">
            {tn('returningGuest', {
              name: `${lookup.match.firstName ?? ''} ${lookup.match.lastName ?? ''}`.trim() || '–',
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
        <div className="mt-3">
          <Field
            id="cust_email" name="cust_email" type="email"
            label={pickupException ? tn('email') : `${tn('email')} *`} maxLength={254}
            required={!pickupException}
          />
        </div>
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{tn('hotelTitle')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <HotelLocationField
            hotels={hotels} defaultHotelId={defaultHotelId} label={`${tn('hotel')} *`}
            chooseLabel={tn('chooseHotel')} otherLabel={tn('otherHotel')} otherNameLabel={tn('otherHotelName')}
          />
          <Field id="room_number" name="room_number" label={tn('room')} maxLength={16} />
        </div>
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{tn('carTitle')}</h2>
        <label className="ir-label" htmlFor="car_id">{tn('chooseCar')} *</label>
        <select
          id="car_id" name="car_id" className="ir-field" value={carId}
          onChange={(e) => setCarId(e.target.value)} required
        >
          <option value="" disabled>{tn('chooseCarPlaceholder')}</option>
          {cars.map((c) => (
            <option key={c.id} value={c.id}>{c.plate} · {c.make} {c.model} ({c.category_code})</option>
          ))}
        </select>
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{tn('datesTitle')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ir-label" htmlFor="start_date">{tn('pickupDate')} *</label>
            <input
              id="start_date" name="start_date" type="date" className="ir-field" required
              value={start} onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <label className="ir-label" htmlFor="end_date">{tn('returnDate')} *</label>
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
          rep can correct. Pick-up is bounded to the window unless the boss
          flags an exception (same rule as R3's NewBookingForm); drop-off stays
          free.
        */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="ir-label" htmlFor="pickup_time">{tn('pickupTime')}</label>
            <input
              id="pickup_time" name="pickup_time" type="time" className="ir-field"
              defaultValue={pickupTimeDefault ?? windows.pickupFrom}
              aria-describedby="pickup_time_hint"
              min={pickupException ? undefined : windows.pickupFrom}
              max={pickupException ? undefined : windows.pickupTo}
            />
            <p className="ir-hint" id="pickup_time_hint">
              {pickupException
                ? tn('exceptionBooking')
                : isAdmin
                  ? tn('pickupWindowLocked', { from: windows.pickupFrom, to: windows.pickupTo })
                  : tn('pickupWindowLockedRep', { from: windows.pickupFrom, to: windows.pickupTo })}
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

        {/* The boss's alone, as on R3 (docs/01-DECISIONS.md §37). */}
        {isAdmin ? (
          <div className="mt-3">
            <label className="flex min-h-11 items-center gap-2.5 text-[1.0625rem] text-ink">
              <input
                type="checkbox" name="pickup_exception" checked={pickupException}
                onChange={(e) => setPickupException(e.target.checked)}
                className="size-5 rounded border-control"
              />
              {tn('exceptionBooking')}
            </label>
            {pickupException ? (
              <div className="mt-2">
                <label className="ir-label" htmlFor="pickup_exception_reason">
                  {tn('exceptionReasonLabel')} *
                </label>
                <input
                  id="pickup_exception_reason" name="pickup_exception_reason"
                  type="text" className="ir-field" maxLength={300} required
                />
                <p className="ir-hint mt-2">{tn('exceptionHint')}</p>
              </div>
            ) : null}
          </div>
        ) : null}
        {!validDates && start && end ? (
          <p className="ir-error mt-2" role="alert">
            <span aria-hidden="true">!</span>{te('IR104')}
          </p>
        ) : null}
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('seatsTitle')}</h2>
        <div className="flex flex-col gap-3">
          {SEAT_TYPES.map((seat) => {
            const qty = seatQty[seat]
            return (
              <div key={seat} className="flex items-center justify-between gap-3">
                <span className="text-[1.0625rem] text-ink">{tn(`seat.${seat}`)}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={tn('seatDecrease', { seat: tn(`seat.${seat}`) })}
                    disabled={qty === 0}
                    onClick={() => setSeatQty((prev) => ({ ...prev, [seat]: Math.max(0, prev[seat] - 1) }))}
                    className="flex size-11 items-center justify-center rounded-field border border-control text-lg font-semibold text-ink hover:bg-brand-tint disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-[1.0625rem] tabular-nums" aria-live="polite">{qty}</span>
                  <button
                    type="button"
                    aria-label={tn('seatIncrease', { seat: tn(`seat.${seat}`) })}
                    disabled={qty === MAX_SEAT_QTY}
                    onClick={() => setSeatQty((prev) => ({ ...prev, [seat]: Math.min(MAX_SEAT_QTY, prev[seat] + 1) }))}
                    className="flex size-11 items-center justify-center rounded-field border border-control text-lg font-semibold text-ink hover:bg-brand-tint disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
                {Array.from({ length: qty }, (_, i) => (
                  <input key={i} type="hidden" name="seat" value={seat} />
                ))}
              </div>
            )
          })}
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
        ) : quote?.total !== undefined ? (
          <p className="text-[1.25rem] font-semibold">
            {tn('priceBreakdown', { days: quote.days ?? 0 })}
            <span className="ml-2 text-brand">{formatEuros(quote.total)}</span>
          </p>
        ) : (
          <p className="text-ink-soft">{tc('loading')}</p>
        )}
      </section>

      <SubmitButton label={submitLabel} />
    </form>
  )
}
