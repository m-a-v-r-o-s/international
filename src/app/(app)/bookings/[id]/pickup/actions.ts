'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { saveHandoverFuel, type HandoverState } from '@/lib/handover/fuel'

export type PickupState = { error?: ErrorKey; saved?: boolean } | undefined

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const nameSchema = z.string().trim().min(1).max(80)
const centsSchema = z.coerce.number().int().min(0).max(100_000_00)

/**
 * R4 step 1 — driver entry, manual.
 *
 * `docs/01-DECISIONS.md` §10 makes manual entry a first-class path rather than
 * an error path, and OCR a convenience on top of it. This phase builds the
 * first-class path only: the licence PHOTOS (`front_image_path` /
 * `back_image_path`) need the private Storage bucket, which is not wired yet,
 * so they stay null and only the typed licence fields are captured
 * (docs/06-IMPLEMENTATION-NOTES.md, "Not done").
 *
 * Every driver on the booking is checked at the gate, not only the main one —
 * an additional driver is free of charge (§9) but is still driving
 * (app.assert_drivers_eligible()).
 */
export async function saveDriver(_prev: PickupState, formData: FormData): Promise<PickupState> {
  await requireUnlocked()

  const parsed = z.object({
    id: uuidSchema.optional(),
    booking_id: uuidSchema,
    is_main: z.coerce.boolean(),
    first_name: nameSchema,
    last_name: nameSchema,
    dob: dateSchema,
    licence_number: z.string().trim().min(1).max(40),
    licence_country: z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}$/),
    licence_issued_on: dateSchema,
    licence_expires_on: dateSchema,
  }).safeParse({
    id: formData.get('id') || undefined,
    booking_id: formData.get('booking_id'),
    is_main: formData.get('is_main') === 'true',
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    dob: formData.get('dob'),
    licence_number: formData.get('licence_number'),
    licence_country: formData.get('licence_country'),
    licence_issued_on: formData.get('licence_issued_on'),
    licence_expires_on: formData.get('licence_expires_on'),
  })
  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.licence_expires_on < parsed.data.licence_issued_on) return { error: 'IR104' }

  const { id, booking_id, ...fields } = parsed.data
  const supabase = await supabaseServer()

  // `booking_drivers_rw` resolves to app.can_read_booking(), so a booking id
  // belonging to another rep is refused by the policy, not by this check.
  const { error } = id
    ? await supabase.from('booking_drivers').update(fields).eq('id', id).eq('booking_id', booking_id)
    : await supabase.from('booking_drivers').insert({ booking_id, ...fields })

  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${booking_id}/pickup`)
  return { saved: true }
}

export async function removeDriver(_prev: PickupState, formData: FormData): Promise<PickupState> {
  await requireUnlocked()

  const parsed = z.object({ id: uuidSchema, booking_id: uuidSchema }).safeParse({
    id: formData.get('id'),
    booking_id: formData.get('booking_id'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('booking_drivers')
    .delete().eq('id', parsed.data.id).eq('booking_id', parsed.data.booking_id)

  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${parsed.data.booking_id}/pickup`)
  return { saved: true }
}

/**
 * R4 step 3 — fuel out. The write itself is shared with R5's fuel in
 * (src/lib/handover/fuel.ts); which `handovers.kind` it lands on is decided
 * by which flow you are in, not by anything the client sends.
 */
export async function saveFuelOut(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  return saveHandoverFuel(formData, 'pickup')
}

/**
 * R4 step 7 — payment. Amount collected, method, paid/unpaid
 * (docs/01-DECISIONS.md §15). No deposit is taken and none is built.
 *
 * A rep never sets the PRICE — `total_cents` is not in their column grant and
 * the guard trigger would revert it anyway. What they record here is what the
 * guest actually handed over, which is a different number and the only money
 * field a rep may write.
 */
export async function savePayment(_prev: PickupState, formData: FormData): Promise<PickupState> {
  await requireUnlocked()

  const parsed = z.object({
    booking_id: uuidSchema,
    collected_cents: centsSchema,
    pay_method: z.enum(['cash', 'card', 'transfer']).nullable(),
    paid: z.coerce.boolean(),
  }).safeParse({
    booking_id: formData.get('booking_id'),
    collected_cents: formData.get('collected_cents') || 0,
    pay_method: formData.get('pay_method') || null,
    paid: formData.get('paid') === 'on',
  })
  if (!parsed.success) return { error: 'IR104' }

  const { booking_id, ...fields } = parsed.data
  const supabase = await supabaseServer()
  const { error } = await supabase.from('bookings').update(fields).eq('id', booking_id)

  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${booking_id}/pickup`)
  return { saved: true }
}

/**
 * R4 confirm → Out.
 *
 * The eligibility gate lives on this transition, in the database
 * (app.assert_drivers_eligible(), supabase/migrations/20260830091000_guards.sql).
 * There is deliberately no check here that could be forgotten, skipped or
 * routed around: this action sends the transition and reports what the
 * database said. IR120 means a driver failed a rule, IR121 means no driver was
 * recorded at all, and neither has a rep-side override — only the boss's
 * admin_override_eligibility() clears it (docs/01-DECISIONS.md §11).
 */
export async function completePickup(_prev: PickupState, formData: FormData): Promise<PickupState> {
  await requireUnlocked()

  const parsed = uuidSchema.safeParse(formData.get('booking_id'))
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('bookings').update({ status: 'out' }).eq('id', parsed.data)

  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${parsed.data}`)
  revalidatePath(`/bookings/${parsed.data}/pickup`)
  revalidatePath('/')
  return { saved: true }
}
