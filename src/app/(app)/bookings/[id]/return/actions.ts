'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey } from '@/lib/errors'
import { saveHandoverFuel, type HandoverState } from '@/lib/handover/fuel'

const uuidSchema = z.string().uuid()

/**
 * R5 step 1 — fuel in. Same write as R4's fuel out, landing on the `return`
 * handover (src/lib/handover/fuel.ts). The reading is recorded here; whether
 * it is SHORT is decided at confirm, so a rep who re-reads the gauge and
 * corrects themselves does not leave a trail of contradictory flags in the
 * boss's inbox.
 */
export async function saveFuelIn(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  return saveHandoverFuel(formData, 'return')
}

/**
 * R5 step 3 — confirm → Returned.
 *
 * Two things happen, in this order and for this reason:
 *
 * 1. The evidence is flagged. A fuel shortfall and any new damage mark each
 *    raise an `exceptions` row — and that is ALL the rep does with them. They
 *    are recorded and flagged, never priced, never argued, never collected
 *    (docs/01-DECISIONS.md §14). `charge` and `resolution` are not in
 *    the rep's column grant at all; the boss sets them through
 *    admin_resolve_exception() from A6 and nowhere else.
 * 2. The rental moves to `returned`, which drops it out of the exclusion
 *    constraint's predicate and therefore out of availability() — so an early
 *    return reopens the remaining dates immediately (§4). The price does not
 *    change: an early return earns no refund.
 *
 * Flags before the transition, because the evidence must not be lost if the
 * transition fails; and each insert is guarded by an existence check, because
 * the transition is not what makes it happen only once.
 */
export async function completeReturn(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  const staff = await requireUnlocked()

  const parsed = uuidSchema.safeParse(formData.get('booking_id'))
  if (!parsed.success) return { error: 'IR104' }
  const bookingId = parsed.data

  const supabase = await supabaseServer()

  const { data: booking, error: bookingError } = await supabase.from('bookings')
    .select('id, status, car_id').eq('id', bookingId).eq('kind', 'rental').maybeSingle()
  if (bookingError) return { error: errorKey(bookingError) }
  if (!booking) return { error: 'IR112' }
  if (booking.status !== 'out') return { error: 'IR109' }

  const [{ data: handovers }, { data: car }] = await Promise.all([
    supabase.from('handovers').select('id, kind, fuel_eighths').eq('booking_id', bookingId),
    supabase.from('cars').select('id, model_id').eq('id', booking.car_id).maybeSingle(),
  ])

  const { data: model } = car
    ? await supabase.from('car_models').select('tank_litres').eq('id', car.model_id).maybeSingle()
    : { data: null }

  const pickup = (handovers ?? []).find((h) => h.kind === 'pickup')
  const ret = (handovers ?? []).find((h) => h.kind === 'return')
  if (!ret) return { error: 'IR104' }

  const { data: existing } = await supabase.from('exceptions')
    .select('id, type').eq('booking_id', bookingId)
  const alreadyRaised = new Set((existing ?? []).map((e) => e.type))

  // ── Fuel shortfall ────────────────────────────────────────────────────────
  const out = pickup?.fuel_eighths ?? null
  const back = ret.fuel_eighths ?? null
  if (out !== null && back !== null && back < out && !alreadyRaised.has('fuel_short')) {
    // The detail is numbers and symbols on purpose: it is stored once and read
    // by a manager in either language, so it must not be a sentence in one of
    // them. A6 renders the readings themselves with translated labels.
    const tank = model?.tank_litres ?? null
    const short = out - back
    const litres = tank !== null ? ` ≈ ${((tank * short) / 8).toFixed(1)} L` : ''
    const { error } = await supabase.from('exceptions').insert({
      booking_id: bookingId,
      type: 'fuel_short',
      detail: `${out}/8 → ${back}/8 (−${short}/8${litres})`,
      raised_by: staff.id,
    })
    if (error) return { error: errorKey(error) }
  }

  // ── New damage ────────────────────────────────────────────────────────────
  const { data: newMarks } = await supabase.from('damage_marks')
    .select('id, view, mark_type').eq('handover_id', ret.id).order('created_at')

  if ((newMarks ?? []).length > 0 && !alreadyRaised.has('new_damage')) {
    const summary = (newMarks ?? []).map((m) => `${m.view}/${m.mark_type}`).join(', ')
    const { error } = await supabase.from('exceptions').insert({
      booking_id: bookingId,
      type: 'new_damage',
      detail: `${(newMarks ?? []).length}: ${summary}`,
      raised_by: staff.id,
    })
    if (error) return { error: errorKey(error) }
  }

  const { error } = await supabase.from('bookings')
    .update({ status: 'returned' }).eq('id', bookingId)
  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${bookingId}`)
  revalidatePath(`/bookings/${bookingId}/return`)
  revalidatePath('/')
  return { saved: true }
}
