'use server'

import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { loadCarsWithSpecs, loadAvailability } from '@/lib/availability/load'
import { swapCandidates, currentCarFreeThrough } from '@/lib/availability/types'
import { errorKey, type ErrorKey } from '@/lib/errors'

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export type ExtensionCheckState = {
  error?: ErrorKey
  currentCarFree?: boolean
  alternatives?: { id: string; plate: string; make: string; model: string }[]
} | undefined

/**
 * R7 · Extend — is this actually possible, and if not, what can we swap into?
 *
 * The rental's own dates and car are read from the booking row rather than
 * taken from the form. The client has no business asserting when its own
 * rental started, and the answer changes which cars are offered.
 *
 * A swap moves the WHOLE rental onto the new plate — one booking row holds one
 * car — so a candidate has to be free from the original pickup date through
 * the new return date, not merely over the days being added
 * (docs/06-IMPLEMENTATION-NOTES.md). Availability is therefore loaded over
 * that whole range. Offering a car that is free only for the extension is
 * offering one the exclusion constraint refuses at the moment the rep
 * confirms, with the guest standing there.
 *
 * This remains a convenience either way: the guard trigger and the constraint
 * are the authority on whether a swap is allowed, and this only avoids sending
 * a request that was never going to succeed.
 */
export async function checkExtension(
  _prev: ExtensionCheckState, formData: FormData,
): Promise<ExtensionCheckState> {
  await requireUnlocked()

  const parsed = z.object({
    booking_id: uuidSchema,
    new_end_date: dateSchema,
  }).safeParse({
    booking_id: formData.get('booking_id'),
    new_end_date: formData.get('new_end_date'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()

  const { data: booking, error: bookingError } = await supabase.from('bookings')
    .select('id, car_id, category_id, start_date, end_date, status')
    .eq('id', parsed.data.booking_id).eq('kind', 'rental').maybeSingle()
  if (bookingError) return { error: errorKey(bookingError) }
  if (!booking) return { error: 'IR112' }

  // A rental in progress cannot be shortened — the guard raises IR110. Say so
  // here rather than sending a write that is certain to be refused.
  if (parsed.data.new_end_date < booking.end_date) return { error: 'IR110' }

  const cars = await loadCarsWithSpecs(supabase)
  const currentCar = cars.find((c) => c.id === booking.car_id)
  if (!currentCar) return { error: 'IR107' }

  let occupied
  try {
    occupied = await loadAvailability(supabase, booking.start_date, parsed.data.new_end_date)
  } catch (err) {
    return { error: errorKey(err as { code?: string }) }
  }

  const currentCarFree = currentCarFreeThrough(
    occupied.get(currentCar.id) ?? [], booking.end_date, parsed.data.new_end_date)

  if (currentCarFree) return { currentCarFree: true, alternatives: [] }

  const alternatives = swapCandidates(cars, occupied, {
    currentCarId: currentCar.id,
    categoryId: currentCar.category_id,
    start: booking.start_date,
    end: parsed.data.new_end_date,
  }).map((c) => ({ id: c.id, plate: c.plate, make: c.make, model: c.model }))

  return { currentCarFree: false, alternatives }
}
