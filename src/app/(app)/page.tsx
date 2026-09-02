import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { todayAthens } from '@/lib/dates'
import { CashStrip } from './CashStrip'
import { loadDayMovements } from '@/lib/movements/data'
import { MovementCard } from '@/components/MovementCard'

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
 * this screen widens nothing. A completed pickup or return stays in its list
 * ticked rather than vanishing (loadDayMovements), so this screen and the
 * dedicated Pickups/Drop-offs screens always agree on what's done.
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

  const [{ pickups, returns, carById, modelById, hotelById }, { data: cash }, { data: ready }] = await Promise.all([
    loadDayMovements(supabase, today),
    supabase.rpc('my_cash_in_hand'),
    supabase.rpc('my_cash_ready_to_hand_over'),
  ])

  const card = (booking: (typeof pickups)[number], kind: 'pickup' | 'return') => {
    const car = carById.get(booking.car_id)
    const model = car ? modelById.get(car.model_id) : undefined
    const done = kind === 'pickup' ? booking.status !== 'booked' : booking.status === 'returned'

    return (
      <MovementCard
        key={booking.id}
        booking={booking}
        kind={kind}
        done={done}
        car={car}
        model={model}
        hotelName={booking.hotel_id ? hotelById.get(booking.hotel_id) : undefined}
        statusLabel={tb(`status.${booking.status}`)}
        actionLabel={kind === 'pickup' ? t('startPickup') : t('startReturn')}
        doneLabel={kind === 'pickup' ? t('pickedUp') : t('droppedOff')}
        roomLabel={booking.room_number ? t('room', { room: booking.room_number }) : null}
      />
    )
  }

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft tabular-nums">{today}</p>
      </div>

      <section aria-labelledby="pickups-heading" className="flex flex-col gap-3">
        <h2 id="pickups-heading" className="text-[1.25rem] font-semibold">{t('pickups')}</h2>
        {pickups.length === 0 ? (
          <p className="text-ink-soft">{t('noPickups')}</p>
        ) : (
          <ul className="flex flex-col gap-3">{pickups.map((b) => card(b, 'pickup'))}</ul>
        )}
      </section>

      <section aria-labelledby="returns-heading" className="flex flex-col gap-3">
        <h2 id="returns-heading" className="text-[1.25rem] font-semibold">{t('returns')}</h2>
        {returns.length === 0 ? (
          <p className="text-ink-soft">{t('noReturns')}</p>
        ) : (
          <ul className="flex flex-col gap-3">{returns.map((b) => card(b, 'return'))}</ul>
        )}
      </section>

      <div className="flex flex-col gap-3">
        <Link href="/availability" className="ir-btn-quiet">{t('goToAvailability')}</Link>
        <Link href="/bookings" className="ir-btn-quiet">{t('goToMyBookings')}</Link>
      </div>

      <CashStrip
        cash={typeof cash === 'number' ? cash : 0}
        ready={typeof ready === 'number' ? ready : 0}
      />
    </div>
  )
}
