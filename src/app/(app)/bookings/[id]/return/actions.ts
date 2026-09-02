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
 * Now just the transition, and deliberately so. It used to flag two things on
 * the way through — a fuel shortfall and any new damage mark, each raising a
 * queue item for the boss — and neither survives (0030):
 *
 *  · The FUEL shortfall is priced by the database itself, on this very
 *    transition, at the owner's rate per missing eighth
 *    (app.bookings_fuel_charge()). Nothing to flag and nobody to ask.
 *  · NEW DAMAGE is reported by the rep as an incident, in words and
 *    photographs, from /incidents — which is how a cracked mirror is actually
 *    described. Inferring one from taps on a diagram was a poor substitute.
 *
 * What the transition itself does is unchanged: `returned` drops the rental out
 * of the exclusion constraint's predicate and therefore out of availability(),
 * so an early return reopens the remaining dates immediately
 * (docs/01-DECISIONS.md §4). The price does not change — an early return earns
 * no refund.
 */
export async function completeReturn(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  await requireUnlocked()

  const parsed = uuidSchema.safeParse(formData.get('booking_id'))
  if (!parsed.success) return { error: 'IR104' }
  const bookingId = parsed.data

  const supabase = await supabaseServer()

  // The one thing still checked here rather than in the database: a rental
  // cannot close without the return handover, because that reading is what the
  // fuel charge is computed from and a rental closed without one can never get
  // a second chance at it. Everything else about the transition — who may make
  // it, from which state — is the guard trigger's, and is not restated here.
  const { data: ret } = await supabase.from('handovers')
    .select('id').eq('booking_id', bookingId).eq('kind', 'return').maybeSingle()
  if (!ret) return { error: 'IR104' }

  const { error } = await supabase.from('bookings')
    .update({ status: 'returned' }).eq('id', bookingId)
  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${bookingId}`)
  revalidatePath(`/bookings/${bookingId}/return`)
  revalidatePath('/')
  return { saved: true }
}
