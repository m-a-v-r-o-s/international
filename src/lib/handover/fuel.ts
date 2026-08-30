import 'server-only'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'

export type HandoverState = { error?: ErrorKey; saved?: boolean } | undefined

const uuidSchema = z.string().uuid()
const eighthsSchema = z.coerce.number().int().min(0).max(8)

/**
 * Fuel out (R4 step 3) and fuel in (R5 step 1) are the same write against the
 * same table, differing only in `handovers.kind` — so `kind` is decided by
 * which flow called this, never sent by the client. It lives here rather than
 * in either flow's `actions.ts` so that neither becomes an exported server
 * action taking a `kind` a caller could choose.
 *
 * Fuel is recorded in eighths, the way a fuel gauge is actually read
 * (docs/01-DECISIONS.md §12). There is no odometer, no km and no mileage
 * anywhere in this app, and no litre figure is stored — the tank size on the
 * model is what turns eighths into litres at the point anyone needs to see it.
 *
 * This is also the row the rest of each flow hangs off: damage marks belong to
 * a handover, so recording fuel is what creates the handover and makes the
 * flow resumable if the phone is closed halfway through.
 */
export async function saveHandoverFuel(
  formData: FormData, kind: 'pickup' | 'return',
): Promise<HandoverState> {
  const staff = await requireUnlocked()

  const parsed = z.object({
    booking_id: uuidSchema,
    fuel_eighths: eighthsSchema,
    notes: z.string().trim().max(2000).optional().transform((v) => v || null),
  }).safeParse({
    booking_id: formData.get('booking_id'),
    fuel_eighths: formData.get('fuel_eighths'),
    notes: formData.get('notes'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()

  // `handovers` is unique on (booking_id, kind), and `handovers_rw` resolves to
  // app.can_read_booking() — a booking belonging to another rep is refused by
  // the policy, not by anything decided here.
  const { data: existing, error: readError } = await supabase.from('handovers')
    .select('id').eq('booking_id', parsed.data.booking_id).eq('kind', kind).maybeSingle()
  if (readError) return { error: errorKey(readError) }

  const { error } = existing
    ? await supabase.from('handovers')
        .update({ fuel_eighths: parsed.data.fuel_eighths, notes: parsed.data.notes })
        .eq('id', existing.id)
    : await supabase.from('handovers').insert({
        booking_id: parsed.data.booking_id,
        kind,
        by_profile: staff.id,
        fuel_eighths: parsed.data.fuel_eighths,
        notes: parsed.data.notes,
      })

  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${parsed.data.booking_id}/${kind}`)
  return { saved: true }
}
