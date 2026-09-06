'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { sqlNull } from '@/lib/supabase/args'
import { errorKey, type ErrorKey } from '@/lib/errors'

/**
 * A13 · the overnight shuffle (docs/01-DECISIONS.md §45).
 *
 * Every write goes through a SECURITY DEFINER RPC rather than a table write,
 * for one reason worth stating: ticking a move off has to stamp
 * `car_relocations.done_at` AND move `cars.stationed_at`, and those two done
 * separately can leave the sheet claiming a car is at Belvedere while the fleet
 * list still has it at Μικρή Πόλη. The function does both or neither.
 *
 * `cars.stationed_at` is not in any client UPDATE grant, so these RPCs are not
 * merely the tidy path — they are the only path. requireAdmin() is the second
 * lock; app.assert_admin() inside each function is the one that actually holds.
 */
export type RelocationState = { error?: ErrorKey; saved?: boolean } | undefined

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const uuidSchema = z.string().uuid()

/** `''` is the "stays put" option in the destination select, and means null. */
const destinationSchema = z.union([uuidSchema, z.literal('')])
  .transform((v) => (v === '' ? null : v))

function readTarget(formData: FormData) {
  return { night: formData.get('night'), car: formData.get('car') }
}

const targetSchema = z.object({ night: dateSchema, car: uuidSchema })

function done(): RelocationState {
  revalidatePath('/admin/relocations')
  revalidatePath('/admin/fleet')
  return { saved: true }
}

/**
 * Set where this car goes tonight — or, with the destination left blank, that
 * it stays where it is despite what the derivation proposed. Both are
 * decisions, and the difference between them and "not decided yet" is whether a
 * row exists at all, which is why blank is stored rather than treated as a
 * clear.
 */
export async function setRelocation(
  _prev: RelocationState, formData: FormData,
): Promise<RelocationState> {
  await requireAdmin()

  const parsed = targetSchema.extend({ to: destinationSchema })
    .safeParse({ ...readTarget(formData), to: formData.get('to') })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_set_relocation', {
    p_night: parsed.data.night,
    p_car: parsed.data.car,
    p_to: sqlNull(parsed.data.to),
  })
  if (error) return { error: errorKey(error) }

  return done()
}

/** Forget the decision, so the row goes back to whatever tonight derives. */
export async function clearRelocation(
  _prev: RelocationState, formData: FormData,
): Promise<RelocationState> {
  await requireAdmin()

  const parsed = targetSchema.safeParse(readTarget(formData))
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_clear_relocation', {
    p_night: parsed.data.night,
    p_car: parsed.data.car,
  })
  if (error) return { error: errorKey(error) }

  return done()
}

/**
 * The car has been driven. Stamps the move and moves the car's base with it.
 *
 * The destination is submitted rather than looked up because a DERIVED move has
 * no stored row to look it up from — until this moment it exists only in the
 * derivation. That is not a hole: setRelocation() already lets an admin name
 * any hotel they like, so nothing is reachable here that was not reachable
 * there, and the function re-checks admin either way.
 */
export async function completeRelocation(
  _prev: RelocationState, formData: FormData,
): Promise<RelocationState> {
  await requireAdmin()

  const parsed = targetSchema.extend({ to: uuidSchema })
    .safeParse({ ...readTarget(formData), to: formData.get('to') })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_complete_relocation', {
    p_night: parsed.data.night,
    p_car: parsed.data.car,
    p_to: parsed.data.to,
  })
  if (error) return { error: errorKey(error) }

  return done()
}
