'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import type { BookingInsert, Database } from '@/lib/supabase/database.types'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { findCustomerByPhone } from '@/lib/customers/lookup'
import { athensInstant } from '@/lib/dates'
import { verifyEmail } from '@/lib/email/validate'
import { sendNewBookingConfirmation } from '@/lib/bookings/confirmation'

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export type QuoteState = {
  error?: ErrorKey
  days?: number
  periodId?: string
  total?: number
} | undefined

/**
 * R3 step "Price": the server computes it, the rep reads it. This calls the
 * same quote() RPC the booking is priced with at submit, so the number shown
 * before confirming can never disagree with what the booking is actually
 * charged (docs/02-ARCHITECTURE.md, Engine 2).
 */
export async function previewBookingQuote(_prev: QuoteState, formData: FormData): Promise<QuoteState> {
  await requireUnlocked()

  const parsed = z.object({
    category_id: uuidSchema,
    start: dateSchema,
    end: dateSchema,
  }).safeParse({
    category_id: formData.get('category_id'),
    start: formData.get('start'),
    end: formData.get('end'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { data, error } = await supabase.rpc('quote', {
    p_category_id: parsed.data.category_id,
    p_start: parsed.data.start,
    p_end: parsed.data.end,
  })

  if (error) return { error: errorKey(error) }
  const row = data?.[0]
  if (!row) return { error: 'unknown' }

  return { days: row.days, periodId: row.period_id, total: row.total }
}

/**
 * R3 — recognising a returning guest from the number the rep is typing
 * (docs/01-DECISIONS.md §25a).
 *
 * The booking form captures a name, a phone number and a date of birth; the
 * licence is not seen until pickup. So this fills in the first three and
 * nothing else, and the pickup screen does the rest when the guest is
 * standing there with the licence in their hand.
 *
 * It reports `notFound` explicitly rather than an empty match, because the
 * form has to distinguish "we asked and this is a new guest" from "we have
 * not asked yet" — the first should stop the fields being touched again, the
 * second should not.
 */
export type CustomerLookupState = {
  status: 'found' | 'notFound' | 'error'
  error?: ErrorKey
  match?: {
    firstName: string | null
    lastName: string | null
    dob: string | null
    lastSeenAt: string
  }
} | undefined

export async function lookupCustomer(
  _prev: CustomerLookupState, formData: FormData,
): Promise<CustomerLookupState> {
  await requireUnlocked()

  const phone = z.string().trim().min(4).max(32).safeParse(formData.get('cust_phone'))
  if (!phone.success) return { status: 'notFound' }

  const supabase = await supabaseServer()
  const outcome = await findCustomerByPhone(supabase, phone.data)

  // A refused lookup is never allowed to become a blocked booking. The rep
  // types the guest in exactly as they did before this feature existed.
  if (!outcome.ok) return { status: 'error', error: outcome.reason }
  if (!outcome.match) return { status: 'notFound' }

  return {
    status: 'found',
    match: {
      firstName: outcome.match.firstName,
      lastName: outcome.match.lastName,
      dob: outcome.match.dob,
      lastSeenAt: outcome.match.lastSeenAt,
    },
  }
}

export type CreateBookingState = { error?: ErrorKey; fieldErrors?: Record<string, string> } | undefined

const phoneSchema = z.string().trim().min(4).max(32)
const optionalName = z.string().trim().max(80).optional().transform((v) => v || null)
const timeSchema = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional()

/**
 * R3 confirm → Booked. Only the fields a rep may ever send
 * (docs/01-DECISIONS.md; the column grant refuses everything else). The
 * price, days, period, ref, kind, status and created_by are all filled in by
 * app.bookings_before_write() — nothing computed here, nothing sent from here.
 */
export async function createBooking(
  _prev: CreateBookingState, formData: FormData,
): Promise<CreateBookingState> {
  await requireUnlocked()

  const parsed = z.object({
    car_id: uuidSchema,
    hotel_id: uuidSchema,
    room_number: z.string().trim().max(16).optional().transform((v) => v || null),
    start_date: dateSchema,
    end_date: dateSchema,
    // Never required (docs/01-DECISIONS.md §9 amended): a rep who was not
    // given a name is not held up by it, the same as R3b already treats it.
    cust_first: optionalName,
    cust_last: optionalName,
    cust_phone: phoneSchema,
    cust_dob: dateSchema,
    // Format/MX-checked below, not here — a raw string is all this schema
    // shapes, since an exception booking may legitimately carry an
    // unverified or absent one.
    cust_email: z.string().trim().max(254).optional().transform((v) => v || null),
    pickup_time: timeSchema,
    dropoff_time: timeSchema,
    // The exception path (docs/01-DECISIONS.md §5): checking the box is the
    // rep's claim, but the actual gate is app.bookings_enforce_pickup_window()
    // — an unflagged out-of-window pick-up is refused by the database
    // regardless of what this schema lets through.
    pickup_exception: z.boolean().optional().default(false),
    pickup_exception_reason: z.string().trim().max(300).optional().transform((v) => v || null),
    seats: z.array(z.enum(['infant', 'child', 'booster'])).optional().default([]),
  }).safeParse({
    car_id: formData.get('car_id'),
    hotel_id: formData.get('hotel_id'),
    room_number: formData.get('room_number'),
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date'),
    cust_first: formData.get('cust_first'),
    cust_last: formData.get('cust_last'),
    cust_phone: formData.get('cust_phone'),
    cust_dob: formData.get('cust_dob'),
    cust_email: formData.get('cust_email'),
    pickup_time: formData.get('pickup_time'),
    dropoff_time: formData.get('dropoff_time'),
    pickup_exception: formData.get('pickup_exception') === 'on',
    pickup_exception_reason: formData.get('pickup_exception_reason'),
    seats: formData.getAll('seat'),
  })

  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.end_date < parsed.data.start_date) return { error: 'IR104' }

  // §9's email gate: required and checked for an ordinary booking, waived
  // entirely for an exception one (docs/01-DECISIONS.md, "Exception bookings
  // wait for the boss") — a rep who ticked the box is not blocked by anything
  // else on this form, email included.
  let email: string | null = null
  if (!parsed.data.pickup_exception) {
    if (!parsed.data.cust_email) return { error: 'emailInvalid' }
    const check = await verifyEmail(parsed.data.cust_email)
    if (!check.ok) return { error: check.reason }
    email = check.email
  } else if (parsed.data.cust_email) {
    email = parsed.data.cust_email
  }

  const supabase = await supabaseServer()
  // `ref` and `created_by` are absent on purpose: 0011's insert grant does not
  // include them and app.bookings_before_write() sets both. The generated
  // Insert type describes the table, which requires them; BookingInsert
  // describes the grant, which is what this call actually writes through.
  const newBooking: BookingInsert = {
    car_id: parsed.data.car_id,
    hotel_id: parsed.data.hotel_id,
    room_number: parsed.data.room_number,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date,
    cust_first: parsed.data.cust_first,
    cust_last: parsed.data.cust_last,
    cust_phone: parsed.data.cust_phone,
    cust_dob: parsed.data.cust_dob,
    cust_email: email,
    pickup_at: athensInstant(parsed.data.start_date, parsed.data.pickup_time),
    dropoff_at: athensInstant(parsed.data.end_date, parsed.data.dropoff_time),
    pickup_exception: parsed.data.pickup_exception,
    pickup_exception_reason: parsed.data.pickup_exception_reason,
  }
  const { data: booking, error } = await supabase.from('bookings')
    .insert(newBooking as Database['public']['Tables']['bookings']['Insert'])
    .select('id').single()

  if (error) return { error: errorKey(error) }

  if (parsed.data.seats.length > 0) {
    // Extras are free and non-essential to the booking existing; a failure
    // here should not orphan the rep on an error screen for a car that is
    // already booked. The booking detail page lets them add a seat afterwards.
    await supabase.from('booking_extras').insert(
      parsed.data.seats.map((seat) => ({ booking_id: booking.id, seat })))
  }

  // An exception booking is not live yet — the confirmation goes out when the
  // manager approves it (src/app/(app)/admin/exception-bookings/actions.ts),
  // not now, or the guest would be told about a rental the boss might still
  // refuse.
  if (!parsed.data.pickup_exception) {
    await sendNewBookingConfirmation(supabase, { bookingId: booking.id, email })
  }

  redirect(`/bookings/${booking.id}`)
}
