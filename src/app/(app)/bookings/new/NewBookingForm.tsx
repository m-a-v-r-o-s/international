'use client'

import { useActionState, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import {
  previewBookingQuote, createBooking, lookupCustomer,
  type QuoteState, type CreateBookingState, type CustomerLookupState,
} from './actions'
import type { CarWithSpecs } from '@/lib/availability/types'
import type { BookingWindows, Hotel } from '@/lib/bookings/types'
import { formatEuros } from '@/lib/money'
import { MAX_SEAT_QTY, SEAT_TYPES, type SeatType } from '@/lib/bookings/quick'

export function NewBookingForm({
  cars, hotels, defaultHotelId, preselectedCar, defaultFrom, defaultTo, windows, isAdmin,
}: {
  cars: CarWithSpecs[]
  hotels: Hotel[]
  defaultHotelId?: string
  preselectedCar: CarWithSpecs | null
  defaultFrom?: string
  defaultTo?: string
  windows: BookingWindows
  /**
   * Whether the exception tick-box is on this form at all
   * (docs/01-DECISIONS.md §37). It is the boss's alone, and the server does
   * not take a rep's word for it either: app.bookings_before_write() forces
   * the flag off for a non-admin whatever the request carries.
   */
  isAdmin: boolean
}) {
  const t = useTranslations('newBooking')
  const tc = useTranslations('common')
  const te = useTranslations('errors')

  const [carId, setCarId] = useState(preselectedCar?.id ?? '')
  const [start, setStart] = useState(defaultFrom ?? '')
  const [end, setEnd] = useState(defaultTo ?? '')
  const [seatQty, setSeatQty] = useState<Record<SeatType, number>>({ infant: 0, child: 0, booster: 0 })
  const [pickupException, setPickupException] = useState(false)

  const selectedCar = cars.find((c) => c.id === carId) ?? null

  const [quote, previewAction, previewPending] = useActionState<QuoteState, FormData>(
    previewBookingQuote, undefined)

  // Re-run the price preview whenever the shape of the rental changes. The
  // number shown is never computed here — this only decides *when* to ask.
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
  // The owner's rule is that an exact phone match fills the fields in
  // immediately, with no "is this them?" step. So this is a controlled
  // section: the three guest fields are React state, the match writes into
  // them, and — this is the part that makes it safe — the rep can type over
  // any of them and the notice stays on screen saying where the values came
  // from. Nothing is saved until they press Create.
  //
  // It asks on BLUR, not on every keystroke: a lookup per character would be
  // both useless (a partial number never normalises to a match) and a fast way
  // through the rate limit in public.customer_by_phone().
  const [phone, setPhone] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [dob, setDob] = useState('')
  const [askedFor, setAskedFor] = useState<string | null>(null)

  const [lookup, lookupAction] = useActionState<CustomerLookupState, FormData>(
    lookupCustomer, undefined)

  useEffect(() => {
    const match = lookup?.status === 'found' ? lookup.match : null
    if (!match) return
    // Never blank a field the rep has already typed into: the ledger fills the
    // gaps, it does not overrule the person at the desk.
    setFirst((v) => v || match.firstName || '')
    setLast((v) => v || match.lastName || '')
    setDob((v) => v || match.dob || '')
  }, [lookup])

  const askLedger = () => {
    const trimmed = phone.trim()
    if (trimmed.length < 4 || trimmed === askedFor) return
    setAskedFor(trimmed)
    const fd = new FormData()
    fd.set('cust_phone', trimmed)
    lookupAction(fd)
  }

  const [createState, createAction] = useActionState<CreateBookingState, FormData>(
    createBooking, undefined)

  const validDates = Boolean(start && end && end >= start)

  return (
    <form action={createAction} className="flex flex-col gap-6">
      {createState?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
          {te(createState.error)}
        </p>
      ) : null}

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('datesTitle')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ir-label" htmlFor="start_date">{t('pickupDate')} *</label>
            <input
              id="start_date" name="start_date" type="date" className="ir-field" required
              value={start} onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <label className="ir-label" htmlFor="end_date">{t('returnDate')} *</label>
            <input
              id="end_date" name="end_date" type="date" className="ir-field" required
              value={end} onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
        {/*
          * docs/04-SCREENS.md R3 step 1: "pickup time (default 08:30-11:30),
          * drop-off time (default 18:00-21:00)". §5: pick-up is now ENFORCED
          * — the input is bounded to the admin's window, and the only thing
          * that lifts the bound is the admin's own exception tick-box below
          * (§37), which then requires a reason. Drop-off is untouched: still a
          * plain field, no bound, the database only records whether it fell
          * outside (§5).
          */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="ir-label" htmlFor="pickup_time">{t('pickupTime')}</label>
            <input
              id="pickup_time" name="pickup_time" type="time" className="ir-field"
              defaultValue={windows.pickupFrom} aria-describedby="pickup_time_hint"
              min={pickupException ? undefined : windows.pickupFrom}
              max={pickupException ? undefined : windows.pickupTo}
            />
            <p className="ir-hint" id="pickup_time_hint">
              {pickupException
                ? t('exceptionBooking')
                : isAdmin
                  ? t('pickupWindowLocked', { from: windows.pickupFrom, to: windows.pickupTo })
                  : t('pickupWindowLockedRep', { from: windows.pickupFrom, to: windows.pickupTo })}
            </p>
          </div>
          <div>
            <label className="ir-label" htmlFor="dropoff_time">{t('dropoffTime')}</label>
            <input
              id="dropoff_time" name="dropoff_time" type="time" className="ir-field"
              defaultValue={windows.dropoffFrom} aria-describedby="dropoff_time_hint"
            />
            <p className="ir-hint" id="dropoff_time_hint">
              {t('windowHint', { from: windows.dropoffFrom, to: windows.dropoffTo })}
            </p>
          </div>
        </div>

        {/*
          * The exception (docs/01-DECISIONS.md §37): the boss's own escape
          * hatch out of his own window rule, and nobody else's. A rep does not
          * see it, and the server would drop it if they posted it anyway.
          */}
        {isAdmin ? (
          <div className="mt-3">
            <label className="flex min-h-11 items-center gap-2.5 text-[1.0625rem] text-ink">
              <input
                type="checkbox" name="pickup_exception" checked={pickupException}
                onChange={(e) => setPickupException(e.target.checked)}
                className="size-5 rounded border-control"
              />
              {t('exceptionBooking')}
            </label>
            {pickupException ? (
              <div className="mt-2">
                <label className="ir-label" htmlFor="pickup_exception_reason">
                  {t('exceptionReasonLabel')} *
                </label>
                <input
                  id="pickup_exception_reason" name="pickup_exception_reason"
                  type="text" className="ir-field" maxLength={300} required
                />
                <p className="ir-hint mt-2">{t('exceptionHint')}</p>
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
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('carTitle')}</h2>
        {selectedCar ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">{selectedCar.make} {selectedCar.model}</p>
              <p className="text-[0.8125rem] text-ink-soft">{selectedCar.plate} · {selectedCar.category_code}</p>
            </div>
            <button type="button" onClick={() => setCarId('')} className="ir-btn-quiet !w-auto">
              {t('changeCar')}
            </button>
          </div>
        ) : (
          <div>
            <label className="ir-label" htmlFor="car_id">{t('chooseCar')} *</label>
            <select
              id="car_id" className="ir-field" value={carId}
              onChange={(e) => setCarId(e.target.value)} required
            >
              <option value="" disabled>{t('chooseCarPlaceholder')}</option>
              {cars.map((c) => (
                <option key={c.id} value={c.id}>{c.plate} — {c.make} {c.model} ({c.category_code})</option>
              ))}
            </select>
          </div>
        )}
        <input type="hidden" name="car_id" value={carId} />
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('hotelTitle')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="ir-label" htmlFor="hotel_id">{t('hotel')} *</label>
            <select id="hotel_id" name="hotel_id" className="ir-field" required defaultValue={defaultHotelId}>
              <option value="" disabled>{t('chooseHotel')}</option>
              {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <Field id="room_number" name="room_number" label={t('room')} maxLength={16} />
        </div>
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('guestTitle')}</h2>
        <div className="mb-3">
          <Field
            id="cust_phone" name="cust_phone" type="tel" label={`${t('phone')} *`} required maxLength={32}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={askLedger}
          />
        </div>

        {lookup?.status === 'found' && lookup.match ? (
          <p className="ir-notice border-brand bg-brand-tint mb-3" role="status">
            {t('returningGuest', {
              name: `${lookup.match.firstName ?? ''} ${lookup.match.lastName ?? ''}`.trim() || '—',
            })}
          </p>
        ) : null}
        {lookup?.status === 'error' ? (
          <p className="ir-notice border-warn bg-warn-tint text-warn mb-3" role="status">
            {te(lookup.error ?? 'unknown')}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field
            id="cust_first" name="cust_first" label={t('firstName')} maxLength={80}
            value={first} onChange={(e) => setFirst(e.target.value)}
          />
          <Field
            id="cust_last" name="cust_last" label={t('lastName')} maxLength={80}
            value={last} onChange={(e) => setLast(e.target.value)}
          />
        </div>
        <div className="mt-3">
          <Field
            id="cust_dob" name="cust_dob" type="date" label={`${t('dob')} *`} required
            value={dob} onChange={(e) => setDob(e.target.value)}
          />
        </div>
        <div className="mt-3">
          <Field
            id="cust_email" name="cust_email" type="email"
            label={pickupException ? t('email') : `${t('email')} *`} maxLength={254}
            required={!pickupException}
          />
        </div>
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('extrasTitle')}</h2>
        <div className="flex flex-col gap-3">
          {SEAT_TYPES.map((seat) => {
            const qty = seatQty[seat]
            return (
              <div key={seat} className="flex items-center justify-between gap-3">
                <span className="text-[1.0625rem] text-ink">{t(`seat.${seat}`)}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={t('seatDecrease', { seat: t(`seat.${seat}`) })}
                    disabled={qty === 0}
                    onClick={() => setSeatQty((prev) => ({ ...prev, [seat]: Math.max(0, prev[seat] - 1) }))}
                    className="flex size-11 items-center justify-center rounded-field border border-control text-lg font-semibold text-ink hover:bg-brand-tint disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-[1.0625rem] tabular-nums" aria-live="polite">{qty}</span>
                  <button
                    type="button"
                    aria-label={t('seatIncrease', { seat: t(`seat.${seat}`) })}
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
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('priceTitle')}</h2>
        {!selectedCar || !validDates ? (
          <p className="text-ink-soft">{t('priceNeedsCarAndDates')}</p>
        ) : previewPending ? (
          <p className="text-ink-soft">{tc('loading')}</p>
        ) : quote?.error ? (
          <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(quote.error)}</p>
        ) : quote?.total !== undefined ? (
          <p className="text-[1.25rem] font-semibold">
            {t('priceBreakdown', { days: quote.days ?? 0 })}
            <span className="ml-2 text-brand">{formatEuros(quote.total)}</span>
          </p>
        ) : (
          <p className="text-ink-soft">{tc('loading')}</p>
        )}
      </section>

      <SubmitButton label={t('confirm')} />
    </form>
  )
}
