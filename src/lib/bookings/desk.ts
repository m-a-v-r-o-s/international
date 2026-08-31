import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { loadCarsWithSpecs } from '@/lib/availability/load'
import type { CarWithSpecs } from '@/lib/availability/types'
import type { BookingWindows, Hotel } from './types'

export type DeskContext = {
  cars: CarWithSpecs[]
  hotels: Hotel[]
  /** The rep's own hotel, or the only one there is — R3's "defaults to". */
  defaultHotelId: string | undefined
  windows: BookingWindows
}

/**
 * What every booking-creation screen needs before it can draw a field: the
 * fleet, the hotels this staff member may book at, which of those is theirs,
 * and the admin's default pick-up and drop-off windows.
 *
 * Three screens ask for exactly this now — R3 New booking, R3b Booking
 * confirmation and the walk-in path — and asking three different ways is how
 * one of them ends up defaulting to the wrong hotel. Each query is the
 * caller's own: `staff_hotels()` and `hotel_reps` answer for whoever is
 * signed in, so an admin gets every hotel and a rep gets theirs, with no
 * branch here to get wrong.
 */
export async function loadDeskContext(
  supabase: SupabaseClient<Database>,
): Promise<DeskContext> {
  const [cars, hotelsResult, homeResult, windowsResult] = await Promise.all([
    loadCarsWithSpecs(supabase),
    supabase.rpc('staff_hotels'),
    supabase.from('hotel_reps').select('hotel_id').eq('is_primary', true).maybeSingle(),
    supabase.rpc('booking_windows'),
  ])

  const hotels = (hotelsResult.data ?? []) as Hotel[]
  const homeHotelId = (homeResult.data as { hotel_id: string } | null)?.hotel_id

  // The admin's operating windows (docs/01-DECISIONS.md §5, set on A10). They
  // pre-fill the time fields and print as the hint beside them; the database
  // is what decides whether a chosen time counts as an override.
  const w = ((windowsResult.data ?? []) as {
    pickup_from: string; pickup_to: string; dropoff_from: string; dropoff_to: string
  }[])[0]

  return {
    cars,
    hotels,
    defaultHotelId: hotels.some((h) => h.id === homeHotelId)
      ? homeHotelId
      : hotels.length === 1 ? hotels[0]!.id : undefined,
    windows: {
      pickupFrom: w?.pickup_from ?? '08:30',
      pickupTo: w?.pickup_to ?? '11:30',
      dropoffFrom: w?.dropoff_from ?? '18:00',
      dropoffTo: w?.dropoff_to ?? '21:00',
    },
  }
}
