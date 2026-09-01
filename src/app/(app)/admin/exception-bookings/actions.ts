'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { sendNewBookingConfirmation } from '@/lib/bookings/confirmation'

export type FormState = { error?: ErrorKey; saved?: boolean } | undefined

const uuidSchema = z.string().uuid()

/**
 * The boss clears a pending exception booking to run like any other
 * (docs/01-DECISIONS.md, "Exception bookings wait for the boss";
 * public.admin_approve_exception_booking(), 20260901150000).
 *
 * The confirmation email an ordinary booking gets immediately on creation
 * goes out here instead, for exactly the same reason the booking itself
 * waited: a guest should not be told about a rental the boss might still
 * refuse. If the rep never collected an address — the one thing the
 * exception flag is allowed to waive — there is nothing to send, and
 * sendNewBookingConfirmation() is a no-op for a null email.
 */
export async function approveExceptionBooking(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = uuidSchema.safeParse(formData.get('booking_id'))
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_approve_exception_booking', { p_booking_id: parsed.data })
  if (error) return { error: errorKey(error) }

  const { data: booking } = await supabase.from('bookings')
    .select('cust_email').eq('id', parsed.data).maybeSingle()
  await sendNewBookingConfirmation(supabase, {
    bookingId: parsed.data,
    email: booking?.cust_email ?? null,
  })

  revalidatePath('/admin/exception-bookings')
  return { saved: true }
}

/**
 * The boss refuses one. public.admin_deny_exception_booking() cancels the row
 * in the same move — that is what actually frees the car back up, through the
 * same exclusion-constraint predicate every other cancellation does.
 */
export async function denyExceptionBooking(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = uuidSchema.safeParse(formData.get('booking_id'))
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_deny_exception_booking', { p_booking_id: parsed.data })
  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/exception-bookings')
  return { saved: true }
}
