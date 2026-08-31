import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { todayAthens } from '@/lib/dates'
import { loadDayMovements } from '@/lib/movements/data'
import { MovementCard } from '@/components/MovementCard'

/**
 * A rep's pickups for today on their own screen, reachable straight from the
 * sidebar rather than only as one half of Today. Same rows and the same
 * ticked-when-done behaviour as R1 (lib/movements/data.ts) — just this one
 * list on its own so a rep working through pickups isn't scrolling past
 * returns to get there.
 */
export default async function PickupsPage() {
  await requireUnlocked()
  const t = await getTranslations('today')
  const tb = await getTranslations('bookingDetail')

  const today = todayAthens()
  const supabase = await supabaseServer()
  const { pickups, carById, modelById, hotelById } = await loadDayMovements(supabase, today)

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('pickups')}</h1>
        <p className="text-ink-soft tabular-nums">{today}</p>
      </div>

      {pickups.length === 0 ? (
        <p className="text-ink-soft">{t('noPickups')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pickups.map((booking) => {
            const car = carById.get(booking.car_id)
            const model = car ? modelById.get(car.model_id) : undefined
            return (
              <MovementCard
                key={booking.id}
                booking={booking}
                kind="pickup"
                done={booking.status !== 'booked'}
                car={car}
                model={model}
                hotelName={booking.hotel_id ? hotelById.get(booking.hotel_id) : undefined}
                statusLabel={tb(`status.${booking.status}`)}
                actionLabel={t('startPickup')}
                doneLabel={t('pickedUp')}
                roomLabel={booking.room_number ? t('room', { room: booking.room_number }) : null}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}
