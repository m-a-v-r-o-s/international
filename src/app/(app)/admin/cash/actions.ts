'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'

export type FormState = { error?: ErrorKey } | undefined

/**
 * A12 · The boss confirms one rep's receipt (docs/01-DECISIONS.md §31).
 *
 * admin_confirm_cash_handover() is the only door: `confirmed_by` is withheld
 * from `authenticated` by column grant, same as `exceptions.charge_cents`, so
 * a direct update is refused for the admin as flatly as for a rep. This is
 * also, since this migration, the ONLY thing that moves a booking out of the
 * rep's own my_cash_in_hand() figure — a rep's own "hand over" tap no longer
 * does that on its own.
 */
export async function confirmCashHandover(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.string().uuid().safeParse(formData.get('id'))
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_confirm_cash_handover', { p_id: parsed.data })
  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/cash')
  return undefined
}
