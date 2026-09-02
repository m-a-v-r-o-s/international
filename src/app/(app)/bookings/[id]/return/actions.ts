'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey } from '@/lib/errors'
import { euroAmountSchema } from '@/lib/money'
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
 *
 * What it gained (0031) is the money. The rep takes the fuel shortfall from the
 * guest at the desk, and it is recorded on the RETURN HANDOVER rather than on
 * the booking — that row already knows who took it and on what day, which is
 * what §7's cash-in-hand figure is computed from. Recorded BEFORE the
 * transition and in its own statement, for the same reason the old flags were:
 * money that has changed hands must not be lost because the transition after it
 * failed. The amount is free to differ from what was charged — a guest who
 * argued it down, or paid nothing, is a fact rather than an error.
 */
export async function completeReturn(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  await requireUnlocked()

  const raw = String(formData.get('fuel_collected') ?? '').trim()
  const parsed = z.object({
    booking_id: uuidSchema,
    fuel_collected: raw === '' ? z.literal(0) : euroAmountSchema,
    fuel_pay_method: z.enum(['cash', 'card', 'transfer']).nullable(),
  }).safeParse({
    booking_id: formData.get('booking_id'),
    fuel_collected: raw === '' ? 0 : raw,
    fuel_pay_method: formData.get('fuel_pay_method') || null,
  })
  if (!parsed.success) return { error: 'IR104' }
  const { booking_id: bookingId, fuel_collected: fuelCollected } = parsed.data

  // No money, no method: a car back with a full tank has nothing to pay, and
  // 'cash' sitting on a zero would put an empty row in the boss's day.
  const fuelPayMethod = fuelCollected > 0 ? parsed.data.fuel_pay_method : null

  const supabase = await supabaseServer()

  // The one thing still checked here rather than in the database: a rental
  // cannot close without the return handover, because that reading is what the
  // fuel charge is computed from and a rental closed without one can never get
  // a second chance at it. Everything else about the transition — who may make
  // it, from which state — is the guard trigger's, and is not restated here.
  const { data: ret } = await supabase.from('handovers')
    .select('id').eq('booking_id', bookingId).eq('kind', 'return').maybeSingle()
  if (!ret) return { error: 'IR104' }

  if (fuelCollected > 0) {
    const { error: moneyError } = await supabase.from('handovers')
      .update({ fuel_collected: fuelCollected, fuel_pay_method: fuelPayMethod })
      .eq('id', ret.id)
    if (moneyError) return { error: errorKey(moneyError) }
  }

  const { error } = await supabase.from('bookings')
    .update({ status: 'returned' }).eq('id', bookingId)
  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${bookingId}`)
  revalidatePath(`/bookings/${bookingId}/return`)
  revalidatePath('/')
  return { saved: true }
}
