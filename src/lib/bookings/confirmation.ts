import 'server-only'

import type { supabaseServer } from '@/lib/supabase/server'
import { sendBookingConfirmation } from '@/lib/email/booking-confirmation'

/**
 * Re-reads the booking that was just written and, if there is an address to
 * send it to, mails the guest their pickup time, return time, cost and
 * licence requirements.
 *
 * Takes only an id and re-queries rather than asking each caller to assemble
 * the car/hotel/category detail itself — R3 and R3b both create a booking and
 * both need this, and a booking approved out of 'pending' by the admin queue
 * needs the identical email days later with none of the form state that
 * created it still in memory.
 *
 * Never throws. A booking that exists and a rep who has moved on to the next
 * guest must not be interrupted by a mail server being down — the same
 * posture src/lib/email/mailer.ts already takes, extended to cover the
 * lookups this needs on top of the send itself.
 */
export async function sendNewBookingConfirmation(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  input: { bookingId: string; email: string | null },
): Promise<void> {
  if (!input.email) return

  try {
    const { data: booking } = await supabase.from('bookings')
      .select('ref, car_id, hotel_id, room_number, pickup_at, dropoff_at, total, category_id')
      .eq('id', input.bookingId).maybeSingle()
    if (!booking) return

    const [{ data: car }, { data: hotel }, { data: category }] = await Promise.all([
      supabase.from('cars').select('plate, model_id').eq('id', booking.car_id).maybeSingle(),
      booking.hotel_id
        ? supabase.from('hotels').select('name').eq('id', booking.hotel_id).maybeSingle()
        : Promise.resolve({ data: null }),
      booking.category_id
        ? supabase.from('categories')
            .select('name_el, name_en, min_driver_age, min_licence_years')
            .eq('id', booking.category_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    const { data: model } = car
      ? await supabase.from('car_models').select('make, model').eq('id', car.model_id).maybeSingle()
      : { data: null }

    const carLabel = car
      ? [model ? `${model.make} ${model.model}` : null, car.plate].filter(Boolean).join(' — ')
      : '—'

    await sendBookingConfirmation({
      to: input.email,
      ref: booking.ref,
      carLabel,
      hotelName: hotel?.name ?? null,
      roomNumber: booking.room_number,
      pickupAt: booking.pickup_at,
      dropoffAt: booking.dropoff_at,
      total: booking.total,
      category: category
        ? {
            nameEl: category.name_el,
            nameEn: category.name_en,
            minDriverAge: category.min_driver_age,
            minLicenceYears: category.min_licence_years,
          }
        : null,
    })
  } catch {
    // Best-effort, exactly like mailer.ts's own send(). The booking is already
    // written; nothing here is allowed to make the rep's screen look like it
    // failed.
  }
}
