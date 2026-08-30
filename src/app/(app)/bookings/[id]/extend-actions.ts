'use server'

import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { loadCarsWithSpecs, loadAvailability } from '@/lib/availability/load'
import { isFreeForRange } from '@/lib/availability/types'
import { errorKey, type ErrorKey } from '@/lib/errors'

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export type ExtensionCheckState = {
  error?: ErrorKey
  currentCarFree?: boolean
  alternatives?: { id: string; plate: string; make: string; model: string }[]
} | undefined

/**
 * R7 · Extend — before offering the confirm button, check whether the current
 * car is actually free through the new end date. If not, same-category
 * alternatives are offered (docs/01-DECISIONS.md §18): the swap the guard
 * trigger will accept is exactly "another car in the same category", so the
 * options list here is built from the same category, filtered by the same
 * availability() a rep cannot see around.
 */
export async function checkExtension(
  _prev: ExtensionCheckState, formData: FormData,
): Promise<ExtensionCheckState> {
  await requireUnlocked()

  const parsed = z.object({
    booking_id: uuidSchema,
    car_id: uuidSchema,
    start_date: dateSchema,
    new_end_date: dateSchema,
  }).safeParse({
    booking_id: formData.get('booking_id'),
    car_id: formData.get('car_id'),
    start_date: formData.get('start_date'),
    new_end_date: formData.get('new_end_date'),
  })
  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.new_end_date < parsed.data.start_date) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const cars = await loadCarsWithSpecs(supabase)
  const currentCar = cars.find((c) => c.id === parsed.data.car_id)
  if (!currentCar) return { error: 'IR107' }

  // The extension only needs to be free for the days AFTER the original end —
  // the booking already legitimately holds the car through its current dates.
  const { data: original, error: bookingError } = await supabase.from('bookings')
    .select('end_date').eq('id', parsed.data.booking_id).maybeSingle()
  if (bookingError) return { error: errorKey(bookingError) }

  const checkFrom = original?.end_date && original.end_date > parsed.data.start_date
    ? original.end_date
    : parsed.data.start_date

  let occupied
  try {
    occupied = await loadAvailability(supabase, checkFrom, parsed.data.new_end_date)
  } catch (err) {
    return { error: errorKey(err as { code?: string }) }
  }

  // The booking's own row shows up in availability() as an occupied date on
  // its own car for the range it already holds — exclude those by only
  // treating dates strictly after the current booking's own end as a clash.
  const currentCarDates = (occupied.get(currentCar.id) ?? []).filter((d) => !original?.end_date || d > original.end_date)
  const currentCarFree = currentCarDates.length === 0

  if (currentCarFree) return { currentCarFree: true, alternatives: [] }

  const alternatives = cars
    .filter((c) => c.category_id === currentCar.category_id && c.id !== currentCar.id)
    .filter((c) => isFreeForRange(occupied.get(c.id) ?? [], parsed.data.start_date, parsed.data.new_end_date))
    .map((c) => ({ id: c.id, plate: c.plate, make: c.make, model: c.model }))

  return { currentCarFree: false, alternatives }
}
