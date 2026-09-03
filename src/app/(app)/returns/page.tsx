import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { todayAthens } from '@/lib/dates'
import { loadDayMovements, movementLocation } from '@/lib/movements/data'
import { MovementCard } from '@/components/MovementCard'

/**
 * A rep's drop-offs for today on their own screen — the return-side twin of
 * /pickups. Same rows and the same ticked-when-done behaviour as R1
 * (lib/movements/data.ts).
 */
export default async function ReturnsPage() {
  await requireUnlocked()
  const t = await getTranslations('today')
  const tb = await getTranslations('bookingDetail')

  const today = todayAthens()
  const supabase = await supabaseServer()
  const { returns, carById, modelById, hotelById } = await loadDayMovements(supabase, today)

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('returns')}</h1>
        <p className="text-ink-soft tabular-nums">{today}</p>
      </div>

      {returns.length === 0 ? (
        <p className="text-ink-soft">{t('noReturns')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {returns.map((booking) => {
            const car = carById.get(booking.car_id)
            const model = car ? modelById.get(car.model_id) : undefined
            return (
              <MovementCard
                key={booking.id}
                booking={booking}
                kind="return"
                done={booking.status === 'returned'}
                car={car}
                model={model}
                hotelName={movementLocation(booking, hotelById)}
                statusLabel={tb(`status.${booking.status}`)}
                actionLabel={t('startReturn')}
                doneLabel={t('droppedOff')}
                roomLabel={booking.room_number ? t('room', { room: booking.room_number }) : null}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}
