'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { ZONES, zoneToPoint, roundCoord, type Zone } from '@/lib/damage/zones'

export type DamageState = { error?: ErrorKey; saved?: boolean } | undefined

const uuidSchema = z.string().uuid()
const viewSchema = z.enum(['front', 'rear', 'left', 'right', 'top'])
const markTypeSchema = z.enum(['scratch', 'dent', 'chip', 'crack', 'other'])
const zoneSchema = z.enum(ZONES)
const coordSchema = z.coerce.number().min(0).max(1)

/**
 * R4 step 4 / R5 step 2 — add one mark to a handover's diagram.
 *
 * The mark belongs to a HANDOVER, not to a booking: `damage_marks_rw` checks
 * `app.can_read_handover()`, which resolves to the booking's own read rule, so
 * a rep cannot attach a mark to a handover on someone else's rental no matter
 * what id they send. `pre_existing` is not accepted from the client — it is
 * decided here from the handover's own kind, because "was this damage already
 * on the car" is a fact about when the mark was recorded, not a client's
 * opinion (docs/01-DECISIONS.md §12).
 *
 * A tapped mark arrives as an exact x/y; a mark placed from the zone select
 * arrives as a zone and is stored at that zone's centre. Both paths produce
 * the same row, which is what makes the diagram usable without a pointer.
 */
export async function addDamageMark(_prev: DamageState, formData: FormData): Promise<DamageState> {
  await requireUnlocked()

  const parsed = z.object({
    handover_id: uuidSchema,
    view: viewSchema,
    zone: zoneSchema,
    x: coordSchema.optional(),
    y: coordSchema.optional(),
    mark_type: markTypeSchema,
    note: z.string().trim().max(500).optional().transform((v) => v || null),
  }).safeParse({
    handover_id: formData.get('handover_id'),
    view: formData.get('view'),
    zone: formData.get('zone'),
    x: formData.get('x') === null || formData.get('x') === '' ? undefined : formData.get('x'),
    y: formData.get('y') === null || formData.get('y') === '' ? undefined : formData.get('y'),
    mark_type: formData.get('mark_type'),
    note: formData.get('note'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()

  // The handover decides both the car the mark is on and whether the mark is
  // pre-existing. Reading it here also means an unreadable handover id fails
  // before anything is written, rather than on the insert's policy check.
  const { data: handover, error: handoverError } = await supabase.from('handovers')
    .select('id, booking_id, kind').eq('id', parsed.data.handover_id).maybeSingle()
  if (handoverError) return { error: errorKey(handoverError) }
  if (!handover) return { error: 'IR112' }

  const { data: booking, error: bookingError } = await supabase.from('bookings')
    .select('id, car_id').eq('id', handover.booking_id).maybeSingle()
  if (bookingError) return { error: errorKey(bookingError) }
  if (!booking) return { error: 'IR112' }

  const fallback = zoneToPoint(parsed.data.zone as Zone)
  const x = roundCoord(parsed.data.x ?? fallback.x)
  const y = roundCoord(parsed.data.y ?? fallback.y)

  const { error } = await supabase.from('damage_marks').insert({
    handover_id: handover.id,
    car_id: booking.car_id,
    view: parsed.data.view,
    x,
    y,
    mark_type: parsed.data.mark_type,
    note: parsed.data.note,
    pre_existing: handover.kind === 'pickup',
  })
  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${handover.booking_id}/${handover.kind}`)
  return { saved: true }
}

/** Remove a mark the rep has just added and thought better of. */
export async function removeDamageMark(_prev: DamageState, formData: FormData): Promise<DamageState> {
  await requireUnlocked()

  const parsed = z.object({ id: uuidSchema, handover_id: uuidSchema }).safeParse({
    id: formData.get('id'),
    handover_id: formData.get('handover_id'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()

  const { data: handover } = await supabase.from('handovers')
    .select('id, booking_id, kind').eq('id', parsed.data.handover_id).maybeSingle()

  // Scoped to the handover as well as the id: RLS would refuse a mark on
  // another rep's handover anyway, but a delete that names only an id is a
  // delete waiting to be pointed at the wrong row.
  const { error } = await supabase.from('damage_marks')
    .delete().eq('id', parsed.data.id).eq('handover_id', parsed.data.handover_id)
  if (error) return { error: errorKey(error) }

  if (handover) revalidatePath(`/bookings/${handover.booking_id}/${handover.kind}`)
  return { saved: true }
}
