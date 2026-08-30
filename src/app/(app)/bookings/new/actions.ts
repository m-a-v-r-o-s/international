'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export type QuoteState = {
  error?: ErrorKey
  days?: number
  periodId?: string
  totalCents?: number
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

  return { days: row.days, periodId: row.period_id, totalCents: row.total_cents }
}

export type CreateBookingState = { error?: ErrorKey; fieldErrors?: Record<string, string> } | undefined

const phoneSchema = z.string().trim().min(4).max(32)
const nameSchema = z.string().trim().min(1).max(80)

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
    cust_first: nameSchema,
    cust_last: nameSchema,
    cust_phone: phoneSchema,
    cust_dob: dateSchema,
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
    seats: formData.getAll('seat'),
  })

  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.end_date < parsed.data.start_date) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { data: booking, error } = await supabase.from('bookings').insert({
    car_id: parsed.data.car_id,
    hotel_id: parsed.data.hotel_id,
    room_number: parsed.data.room_number,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date,
    cust_first: parsed.data.cust_first,
    cust_last: parsed.data.cust_last,
    cust_phone: parsed.data.cust_phone,
    cust_dob: parsed.data.cust_dob,
  }).select('id').single()

  if (error) return { error: errorKey(error) }

  if (parsed.data.seats.length > 0) {
    // Extras are free and non-essential to the booking existing; a failure
    // here should not orphan the rep on an error screen for a car that is
    // already booked. The booking detail page lets them add a seat afterwards.
    await supabase.from('booking_extras').insert(
      parsed.data.seats.map((seat) => ({ booking_id: booking.id, seat })))
  }

  redirect(`/bookings/${booking.id}`)
}
