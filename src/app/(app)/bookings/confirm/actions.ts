'use server'

import { redirect } from 'next/navigation'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import type { BookingInsert, Database } from '@/lib/supabase/database.types'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { athensInstant } from '@/lib/dates'
import { parseQuickBooking } from '@/lib/bookings/quick'
import { verifyEmail } from '@/lib/email/validate'
import { sendNewBookingConfirmation } from '@/lib/bookings/confirmation'

export type QuickBookingState = { error?: ErrorKey } | undefined

/**
 * R3b confirm → Booked (docs/01-DECISIONS.md §30 decision 2).
 *
 * The same insert R3 performs, with a narrower set of fields in front of it.
 * Everything that makes a booking safe still happens underneath: the price
 * comes from the engine, `created_by`, `ref`, `kind` and `status` come from
 * the guard trigger, and the exclusion constraint decides whether the car is
 * free. This action computes none of it and sends none of it.
 *
 * `next` is where the rep goes afterwards, and it is the whole difference
 * between the two screens this serves. From the header button they land on the
 * slip. From the walk-in path they land in licence capture — because a walk-in
 * is one transaction to the rep, and making them find the booking they just
 * created in order to continue it is the kind of step that gets skipped with a
 * guest waiting. Either way the pickup flow is entered at its first step, so
 * the eligibility gate is still in front of the signature (§30 decision 3).
 */
export async function createQuickBooking(
  _prev: QuickBookingState, formData: FormData,
): Promise<QuickBookingState> {
  await requireUnlocked()

  const parsed = parseQuickBooking(formData)
  if (!parsed.ok) return { error: 'IR104' }
  const input = parsed.data

  // Same gate as R3 (docs/01-DECISIONS.md, "Exception bookings wait for the
  // boss"): required and checked on an ordinary call-in, waived entirely once
  // the rep has ticked the exception box.
  let email: string | null = null
  if (!input.pickup_exception) {
    if (!input.cust_email) return { error: 'emailInvalid' }
    const check = await verifyEmail(input.cust_email)
    if (!check.ok) return { error: check.reason }
    email = check.email
  } else if (input.cust_email) {
    email = input.cust_email
  }

  const supabase = await supabaseServer()
  const newBooking: BookingInsert = {
    car_id: input.car_id,
    hotel_id: input.hotel_id,
    room_number: input.room_number,
    start_date: input.start_date,
    end_date: input.end_date,
    // Null unless the caller had one. §9 captures the guest's identity at the
    // desk, and inventing a placeholder name here would put it on a contract.
    cust_first: input.cust_first,
    cust_last: input.cust_last,
    cust_phone: input.cust_phone,
    cust_dob: null,
    cust_email: email,
    pickup_at: athensInstant(input.start_date, input.pickup_time),
    dropoff_at: athensInstant(input.end_date, input.dropoff_time),
    pickup_exception: input.pickup_exception,
    pickup_exception_reason: input.pickup_exception_reason,
  }

  const { data: booking, error } = await supabase.from('bookings')
    .insert(newBooking as Database['public']['Tables']['bookings']['Insert'])
    .select('id').single()

  if (error) return { error: errorKey(error) }

  if (input.seats.length > 0) {
    // As in R3: the seats are free and the booking exists without them, so a
    // failure here does not throw away a car that is now held.
    await supabase.from('booking_extras').insert(
      input.seats.map((seat) => ({ booking_id: booking.id, seat })))
  }

  // As in R3: an exception booking is not live yet, so its confirmation waits
  // for the manager's approval rather than going out now.
  if (!input.pickup_exception) {
    await sendNewBookingConfirmation(supabase, { bookingId: booking.id, email })
  }

  redirect(input.next === 'pickup'
    ? `/bookings/${booking.id}/pickup`
    : `/bookings/${booking.id}`)
}
