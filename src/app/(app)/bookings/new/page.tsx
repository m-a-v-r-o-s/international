import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { loadCarsWithSpecs, loadAvailability } from '@/lib/availability/load'
import { isFreeForRange } from '@/lib/availability/types'
import { NewBookingForm } from './NewBookingForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('newBooking')
  return { title: t('title') }
}

/**
 * R3 · New booking (docs/04-SCREENS.md). Arrives either from R2 with a car and
 * dates already chosen (`?car=&from=&to=`), or cold — in which case the rep
 * picks the car here. Either way the car must actually be free for the whole
 * range: this page re-checks with the same availability() a rep cannot lie
 * to, rather than trusting the query string.
 */
export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireUnlocked()
  const t = await getTranslations('newBooking')
  const params = await searchParams
  const supabase = await supabaseServer()

  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? '') ? params.from! : undefined
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.to ?? '') ? params.to! : undefined

  const [cars, hotelsResult, homeResult] = await Promise.all([
    loadCarsWithSpecs(supabase),
    supabase.rpc('staff_hotels'),
    // "Defaults to the rep's own hotel; changeable when covering elsewhere"
    // (docs/04-SCREENS.md R3). `hotel_reps` is readable for the caller's own
    // rows, so this asks which hotel THEY are stationed at rather than
    // guessing. Before A8 nothing wrote is_primary meaningfully, so the
    // default fell back to "the only hotel there is"; now it is the rule.
    supabase.from('hotel_reps').select('hotel_id').eq('is_primary', true).maybeSingle(),
  ])
  const hotels = hotelsResult.data ?? []
  const homeHotelId = (homeResult.data as { hotel_id: string } | null)?.hotel_id

  let preselectedCar = null
  if (params.car && from && to) {
    const car = cars.find((c) => c.id === params.car)
    if (car) {
      const occupied = await loadAvailability(supabase, from, to)
      if (isFreeForRange(occupied.get(car.id) ?? [], from, to)) {
        preselectedCar = car
      }
    }
  }

  if (cars.length === 0) notFound()

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
      <NewBookingForm
        cars={cars}
        hotels={hotels}
        defaultHotelId={
          hotels.some((h) => h.id === homeHotelId)
            ? homeHotelId
            : hotels.length === 1 ? hotels[0]!.id : undefined
        }
        preselectedCar={preselectedCar}
        defaultFrom={from}
        defaultTo={to}
      />
    </div>
  )
}
