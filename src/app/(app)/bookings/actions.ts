'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'

export type FormState = { error?: ErrorKey } | undefined

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const phoneSchema = z.string().trim().min(4).max(32)
const nameSchema = z.string().trim().min(1).max(80)

/** R7 · Edit, before pickup only — the guard trigger enforces the stage; this is the whitelist. */
export async function updateBooking(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUnlocked()

  const parsed = z.object({
    id: uuidSchema,
    hotel_id: uuidSchema,
    room_number: z.string().trim().max(16).optional().transform((v) => v || null),
    start_date: dateSchema,
    end_date: dateSchema,
    cust_first: nameSchema,
    cust_last: nameSchema,
    cust_phone: phoneSchema,
    cust_dob: dateSchema,
  }).safeParse({
    id: formData.get('id'),
    hotel_id: formData.get('hotel_id'),
    room_number: formData.get('room_number'),
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date'),
    cust_first: formData.get('cust_first'),
    cust_last: formData.get('cust_last'),
    cust_phone: formData.get('cust_phone'),
    cust_dob: formData.get('cust_dob'),
  })
  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.end_date < parsed.data.start_date) return { error: 'IR104' }

  const { id, ...rest } = parsed.data
  const supabase = await supabaseServer()
  const { error } = await supabase.from('bookings').update(rest).eq('id', id)

  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${id}`)
  return undefined
}

export async function cancelBooking(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUnlocked()
  const id = uuidSchema.safeParse(formData.get('id'))
  if (!id.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id.data)

  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${id.data}`)
  revalidatePath('/bookings')
  return undefined
}

/**
 * R7 · Extend, after pickup — the one edit a rep may still make
 * (docs/01-DECISIONS.md §18). Only `end_date` and, for a same-category swap,
 * `car_id` are sent; the guard trigger refuses everything else once a rental
 * is `out`, shortening the rental, and any swap outside the original category.
 */
export async function extendBooking(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUnlocked()

  const parsed = z.object({
    id: uuidSchema,
    end_date: dateSchema,
    car_id: uuidSchema.optional(),
  }).safeParse({
    id: formData.get('id'),
    end_date: formData.get('end_date'),
    car_id: formData.get('car_id') || undefined,
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('bookings')
    .update({ end_date: parsed.data.end_date, ...(parsed.data.car_id ? { car_id: parsed.data.car_id } : {}) })
    .eq('id', parsed.data.id)

  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${parsed.data.id}`)
  return undefined
}

/** R6 · My bookings — search is a plain GET redirect so the URL stays shareable and back-button-safe. */
export async function searchMyBookings(formData: FormData): Promise<void> {
  const query = z.string().trim().max(120).safeParse(formData.get('q'))
  const q = query.success ? query.data : ''
  redirect(q ? `/bookings?q=${encodeURIComponent(q)}` : '/bookings')
}
