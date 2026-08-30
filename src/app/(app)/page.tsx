import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { todayAthens } from '@/lib/dates'
import { CashStrip } from './CashStrip'
import type { BookingRow } from '@/lib/supabase/database.types'

const COLUMNS =
  'id, ref, status, car_id, hotel_id, room_number, start_date, end_date, ' +
  'pickup_at, dropoff_at, cust_first, cust_last'

type Movement = Pick<BookingRow,
  'id' | 'ref' | 'status' | 'car_id' | 'hotel_id' | 'room_number'
  | 'start_date' | 'end_date' | 'pickup_at' | 'dropoff_at' | 'cust_first' | 'cust_last'>

/**
 * R1 · Today (docs/04-SCREENS.md) — the rep's landing screen. Their pickups
 * and returns for today, in time order, each with the one big action that
 * matters, and a footer strip carrying today's cash in hand.
 *
 * Read what is NOT on this screen as carefully as what is. There is no count
 * of the day's pickups, no total taken, no "cars out today" — a rep may never
 * see an aggregate, and the single exception is their own cash in hand
 * (docs/01-DECISIONS.md §7, HANDOFF.md's third sink-the-project rule). A count
 * of rentals starting today, company-wide or even hotel-wide, is a figure
 * company revenue can be worked back from, so it is not here.
 *
 * The rows themselves are just bookings, narrowed by RLS to the ones this rep
 * created or whose hotel they cover — the same set R6 already shows them, so
 * this screen widens nothing.
 */
export default async function HomePage() {
  const staff = await requireUnlocked()
  const t = await getTranslations('today')
  const tb = await getTranslations('bookingDetail')
  const tc = await getTranslations('common')

  if (staff.role === 'admin') {
    const th = await getTranslations('home')
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[1.75rem] font-bold tracking-tight">{th('title')}</h1>
        <p className="text-ink-soft">{tc('signedInAs', { name: staff.fullName || '—' })}</p>
        <p className="ir-card p-5">{th('adminNote')}</p>
        <Link href="/admin/movements" className="ir-btn-primary">{t('goToMovements')}</Link>
        <Link href="/admin/exceptions" className="ir-btn-quiet">{t('goToExceptions')}</Link>
      </div>
    )
  }

  const today = todayAthens()
  const supabase = await supabaseServer()

  const [{ data: pickupRows }, { data: returnRows }, { data: cash }] = await Promise.all([
    supabase.from('bookings').select(COLUMNS)
      .eq('kind', 'rental').eq('start_date', today).eq('status', 'booked'),
    supabase.from('bookings').select(COLUMNS)
      .eq('kind', 'rental').eq('end_date', today).eq('status', 'out'),
    supabase.rpc('my_cash_in_hand'),
  ])

  const pickups = ((pickupRows ?? []) as unknown as Movement[])
    .sort((a, b) => (a.pickup_at ?? '').localeCompare(b.pickup_at ?? ''))
  const returns = ((returnRows ?? []) as unknown as Movement[])
    .sort((a, b) => (a.dropoff_at ?? '').localeCompare(b.dropoff_at ?? ''))

  const carIds = [...new Set([...pickups, ...returns].map((b) => b.car_id))]
  const hotelIds = [...new Set([...pickups, ...returns]
    .map((b) => b.hotel_id).filter((h): h is string => h !== null))]

  const [{ data: cars }, { data: hotels }] = await Promise.all([
    carIds.length > 0
      ? supabase.from('cars').select('id, plate, model_id').in('id', carIds)
      : Promise.resolve({ data: [] }),
    hotelIds.length > 0
      ? supabase.from('hotels').select('id, name').in('id', hotelIds)
      : Promise.resolve({ data: [] }),
  ])

  const modelIds = [...new Set((cars ?? []).map((c) => c.model_id))]
  const { data: models } = modelIds.length > 0
    ? await supabase.from('car_models').select('id, make, model').in('id', modelIds)
    : { data: [] }

  const carById = new Map((cars ?? []).map((c) => [c.id, c]))
  const modelById = new Map((models ?? []).map((m) => [m.id, m]))
  const hotelById = new Map((hotels ?? []).map((h) => [h.id, h.name]))

  const row = (booking: Movement, kind: 'pickup' | 'return') => {
    const car = carById.get(booking.car_id)
    const model = car ? modelById.get(car.model_id) : undefined
    const time = fmtTime(kind === 'pickup' ? booking.pickup_at : booking.dropoff_at)

    return (
      <li key={booking.id} className="ir-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[1.0625rem] font-semibold">
              <span className="tabular-nums">{time}</span> · {car?.plate ?? '—'}
            </p>
            <p className="text-[0.9375rem] text-ink-soft">
              {model ? `${model.make} ${model.model}` : '—'}
            </p>
            <p className="mt-1 text-[0.9375rem]">
              {booking.cust_first} {booking.cust_last}
            </p>
            <p className="text-[0.875rem] text-ink-soft">
              {booking.hotel_id ? hotelById.get(booking.hotel_id) ?? '—' : '—'}
              {booking.room_number ? ` · ${t('room', { room: booking.room_number })}` : ''}
            </p>
          </div>
          <span className="shrink-0 rounded-field bg-brand-tint px-2.5 py-1 text-[0.8125rem] font-medium text-brand">
            {tb(`status.${booking.status}`)}
          </span>
        </div>

        <Link
          href={`/bookings/${booking.id}/${kind}`}
          className="ir-btn-primary mt-3"
        >
          {kind === 'pickup' ? t('startPickup') : t('startReturn')}
        </Link>
      </li>
    )
  }

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('date', { date: today })}</p>
      </div>

      <section aria-labelledby="pickups-heading" className="flex flex-col gap-3">
        <h2 id="pickups-heading" className="text-[1.25rem] font-semibold">{t('pickups')}</h2>
        {pickups.length === 0 ? (
          <p className="text-ink-soft">{t('noPickups')}</p>
        ) : (
          <ul className="flex flex-col gap-3">{pickups.map((b) => row(b, 'pickup'))}</ul>
        )}
      </section>

      <section aria-labelledby="returns-heading" className="flex flex-col gap-3">
        <h2 id="returns-heading" className="text-[1.25rem] font-semibold">{t('returns')}</h2>
        {returns.length === 0 ? (
          <p className="text-ink-soft">{t('noReturns')}</p>
        ) : (
          <ul className="flex flex-col gap-3">{returns.map((b) => row(b, 'return'))}</ul>
        )}
      </section>

      <div className="flex flex-col gap-3">
        <Link href="/availability" className="ir-btn-quiet">{t('goToAvailability')}</Link>
        <Link href="/bookings" className="ir-btn-quiet">{t('goToMyBookings')}</Link>
      </div>

      <CashStrip cents={typeof cash === 'number' ? cash : 0} />
    </div>
  )
}

/** 24-hour, in Athens: the only clock the reps and the boss share. */
function fmtTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Athens',
      })
    : '—'
}
