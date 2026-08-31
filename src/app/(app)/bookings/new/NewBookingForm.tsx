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

const SEAT_TYPES = ['infant', 'child', 'booster'] as const

export function NewBookingForm({
  cars, hotels, defaultHotelId, preselectedCar, defaultFrom, defaultTo, windows,
}: {
  cars: CarWithSpecs[]
  hotels: Hotel[]
  defaultHotelId?: string
  preselectedCar: CarWithSpecs | null
  defaultFrom?: string
  defaultTo?: string
  windows: BookingWindows
}) {
  const t = useTranslations('newBooking')
  const tc = useTranslations('common')
  const te = useTranslations('errors')

  const [carId, setCarId] = useState(preselectedCar?.id ?? '')
  const [start, setStart] = useState(defaultFrom ?? '')
  const [end, setEnd] = useState(defaultTo ?? '')
  const [seats, setSeats] = useState<Set<typeof SEAT_TYPES[number]>>(new Set())

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
            <label className="ir-label" htmlFor="start_date">{t('pickupDate')}</label>
            <input
              id="start_date" name="start_date" type="date" className="ir-field" required
              value={start} onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <label className="ir-label" htmlFor="end_date">{t('returnDate')}</label>
            <input
              id="end_date" name="end_date" type="date" className="ir-field" required
              value={end} onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
        {/*
          * docs/04-SCREENS.md R3 step 1: "pickup time (default 08:30-11:30),
          * drop-off time (default 18:00-21:00)". The window is a HINT and the
          * input is a plain time field, because §5 says the windows are
          * defaults and are overridable — a <select> of allowed slots would
          * make them a rule, which they are not. Whether the chosen time falls
          * outside is not decided here either: the database derives
          * `window_override` from these two values and the admin's settings,
          * so a rep cannot record a 03:00 pick-up as an ordinary one.
          */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="ir-label" htmlFor="pickup_time">{t('pickupTime')}</label>
            <input
              id="pickup_time" name="pickup_time" type="time" className="ir-field"
              defaultValue={windows.pickupFrom} aria-describedby="pickup_time_hint"
            />
            <p className="ir-hint" id="pickup_time_hint">
              {t('windowHint', { from: windows.pickupFrom, to: windows.pickupTo })}
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
            <label className="ir-label" htmlFor="car_id">{t('chooseCar')}</label>
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
            <label className="ir-label" htmlFor="hotel_id">{t('hotel')}</label>
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
            id="cust_phone" name="cust_phone" type="tel" label={t('phone')} required maxLength={32}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={askLedger}
            hint={t('phoneHint')}
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
            id="cust_first" name="cust_first" label={t('firstName')} required maxLength={80}
            value={first} onChange={(e) => setFirst(e.target.value)}
          />
          <Field
            id="cust_last" name="cust_last" label={t('lastName')} required maxLength={80}
            value={last} onChange={(e) => setLast(e.target.value)}
          />
        </div>
        <div className="mt-3">
          <Field
            id="cust_dob" name="cust_dob" type="date" label={t('dob')} required
            value={dob} onChange={(e) => setDob(e.target.value)}
          />
        </div>
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('extrasTitle')}</h2>
        <p className="mb-2 text-[0.875rem] text-ink-soft">{t('extrasHint')}</p>
        <div className="flex flex-col gap-2">
          {SEAT_TYPES.map((seat) => (
            <label key={seat} className="flex min-h-11 items-center gap-2.5 text-[1.0625rem] text-ink">
              <input
                type="checkbox" name="seat" value={seat}
                checked={seats.has(seat)}
                onChange={(e) => {
                  setSeats((prev) => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(seat); else next.delete(seat)
                    return next
                  })
                }}
                className="size-5 rounded border-control"
              />
              {t(`seat.${seat}`)}
            </label>
          ))}
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
        ) : quote?.totalCents !== undefined ? (
          <p className="text-[1.25rem] font-semibold">
            {t('priceBreakdown', { days: quote.days ?? 0 })}
            <span className="ml-2 text-brand">€{(quote.totalCents / 100).toFixed(2)}</span>
          </p>
        ) : (
          <p className="text-ink-soft">{tc('loading')}</p>
        )}
      </section>

      <SubmitButton label={t('confirm')} />
    </form>
  )
}
