'use server'

import { redirect } from 'next/navigation'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import type { BookingInsert, Database } from '@/lib/supabase/database.types'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { athensInstant } from '@/lib/dates'
import { groupSeatExtras, parseQuickBooking } from '@/lib/bookings/quick'
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
  const staff = await requireUnlocked()

  const parsed = parseQuickBooking(formData)
  if (!parsed.ok) return { error: 'IR104' }
  const input = parsed.data

  // Same two rules as R3 (docs/01-DECISIONS.md §37): the exception is the
  // boss's to record, and it is what waives the email — required and checked
  // on every ordinary call-in.
  const exception = staff.role === 'admin' && input.pickup_exception

  let email: string | null = null
  if (!exception) {
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
    pickup_exception: exception,
    pickup_exception_reason: exception ? input.pickup_exception_reason : null,
  }

  const { data: booking, error } = await supabase.from('bookings')
    .insert(newBooking as Database['public']['Tables']['bookings']['Insert'])
    .select('id').single()

  if (error) return { error: errorKey(error) }

  const seatExtras = groupSeatExtras(input.seats)
  if (seatExtras.length > 0) {
    // As in R3: the seats are free and the booking exists without them, so a
    // failure here does not throw away a car that is now held.
    await supabase.from('booking_extras').insert(
      seatExtras.map((e) => ({ booking_id: booking.id, seat: e.seat, qty: e.qty })))
  }

  // As in R3: nothing holds a new booking back any more, so the confirmation
  // goes out now — and is a no-op if the boss waived the address.
  await sendNewBookingConfirmation(supabase, { bookingId: booking.id, email })

  redirect(input.next === 'pickup'
    ? `/bookings/${booking.id}/pickup`
    : `/bookings/${booking.id}`)
}
