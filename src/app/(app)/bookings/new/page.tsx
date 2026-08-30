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

  const [cars, hotelsResult] = await Promise.all([
    loadCarsWithSpecs(supabase),
    supabase.rpc('staff_hotels'),
  ])
  const hotels = hotelsResult.data ?? []

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
        defaultHotelId={hotels.length === 1 ? hotels[0]!.id : undefined}
        preselectedCar={preselectedCar}
        defaultFrom={from}
        defaultTo={to}
      />
    </div>
  )
}
