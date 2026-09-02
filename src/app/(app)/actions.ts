'use server'

import { revalidatePath } from 'next/cache'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'

export type HandOverState = { error?: ErrorKey; amount?: number } | undefined

/**
 * R1's footer strip — the rep hands over today's cash.
 *
 * This is the ONE aggregate a rep is ever shown (docs/01-DECISIONS.md §7), and
 * handing it over takes no arguments on purpose. An amount the client could
 * name is an amount the client could get wrong, and which bookings the
 * handover covers is not the client's business either: my_hand_over_cash()
 * reads both from the same predicate my_cash_in_hand() reports on, so the
 * receipt can never cover a different set of bookings from the figure printed
 * above the button.
 *
 * IR114 comes back when there is nothing to hand over — a double-tap, or a
 * stale page — and says so rather than recording an empty receipt.
 */
export async function handOverCash(_prev: HandOverState, _formData: FormData): Promise<HandOverState> {
  await requireUnlocked()

  const supabase = await supabaseServer()
  const { data, error } = await supabase.rpc('my_hand_over_cash')
  if (error) return { error: errorKey(error) }

  revalidatePath('/')
  return { amount: data?.[0]?.amount ?? 0 }
}
