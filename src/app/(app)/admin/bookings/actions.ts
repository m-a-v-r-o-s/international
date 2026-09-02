'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { euroAmountSchema } from '@/lib/money'

export type FormState = { error?: ErrorKey } | undefined

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const phoneSchema = z.string().trim().min(4).max(32)
const nameSchema = z.string().trim().min(1).max(80)
const statusSchema = z.enum(['booked', 'out', 'returned', 'cancelled', 'no_show'])
const payMethodSchema = z.enum(['cash', 'card', 'transfer'])

/** A5 · Search is a plain GET redirect, same shape as R6's, so the URL stays shareable. */
export async function searchAllBookings(formData: FormData): Promise<void> {
  await requireAdmin()
  const query = z.string().trim().max(120).safeParse(formData.get('q'))
  const q = query.success ? query.data : ''
  redirect(q ? `/admin/bookings?q=${encodeURIComponent(q)}` : '/admin/bookings')
}

/**
 * A5 · Full edit rights at any stage (docs/04-SCREENS.md). The admin branch of
 * app.bookings_before_write() does not lock any field to the booking's stage —
 * that locking only applies `not v_is_admin` — so this one action covers what
 * R7's rep-facing updateBooking() needs two paths for (before/after pickup).
 * `total` is deliberately absent from this whitelist: the column grant
 * excludes it even for admin, and the only door is admin_set_booking_price()
 * below, which is audited the same as every other write.
 */
export async function adminUpdateBooking(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    id: uuidSchema,
    car_id: uuidSchema,
    hotel_id: uuidSchema.nullable(),
    room_number: z.string().trim().max(16).optional().transform((v) => v || null),
    start_date: dateSchema,
    end_date: dateSchema,
    cust_first: nameSchema,
    cust_last: nameSchema,
    cust_phone: phoneSchema,
    cust_dob: dateSchema,
    status: statusSchema,
    collected: euroAmountSchema,
    pay_method: payMethodSchema.nullable(),
    paid: z.coerce.boolean(),
  }).safeParse({
    id: formData.get('id'),
    car_id: formData.get('car_id'),
    hotel_id: formData.get('hotel_id') || null,
    room_number: formData.get('room_number'),
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date'),
    cust_first: formData.get('cust_first'),
    cust_last: formData.get('cust_last'),
    cust_phone: formData.get('cust_phone'),
    cust_dob: formData.get('cust_dob'),
    status: formData.get('status'),
    collected: formData.get('collected') || 0,
    pay_method: formData.get('pay_method') || null,
    paid: formData.get('paid') === 'on',
  })
  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.end_date < parsed.data.start_date) return { error: 'IR104' }

  const { id, ...rest } = parsed.data
  const supabase = await supabaseServer()
  const { error } = await supabase.from('bookings').update(rest).eq('id', id)

  if (error) return { error: errorKey(error) }

  revalidatePath(`/admin/bookings/${id}`)
  revalidatePath('/admin/bookings')
  return undefined
}

/**
 * The one way a booking's total is ever changed by hand
 * (docs/01-DECISIONS.md §6). Never a direct update to total — the
 * column grant refuses that even for admin — always this RPC, which the
 * database audits like every other write.
 */
export async function adminSetBookingPrice(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    id: uuidSchema,
    total: euroAmountSchema,
  }).safeParse({
    id: formData.get('id'),
    total: formData.get('total'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_set_booking_price', {
    p_booking_id: parsed.data.id,
    p_total: parsed.data.total,
  })

  if (error) return { error: errorKey(error) }

  revalidatePath(`/admin/bookings/${parsed.data.id}`)
  revalidatePath('/admin/bookings')
  return undefined
}
