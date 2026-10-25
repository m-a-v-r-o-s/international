'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { gratisUnlocked } from '@/lib/auth/gratis'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'

export type FormState = { error?: ErrorKey } | undefined

/**
 * A14 · The boss settles one pay-after balance, all of it (docs/01-DECISIONS.md
 * §47). admin_settle_pay_after() is the only door: the settlement columns have
 * no grant, and the function works the amount out itself.
 */
export async function settlePayAfter(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin()

  const parsed = z.discriminatedUnion('outcome', [
    z.object({ booking_id: z.string().uuid(), outcome: z.literal('paid'), method: z.enum(['cash', 'card']) }),
    z.object({ booking_id: z.string().uuid(), outcome: z.literal('gratis') }),
  ]).safeParse({
    booking_id: formData.get('booking_id'),
    outcome: formData.get('outcome'),
    method: formData.get('method') ?? undefined,
  })
  if (!parsed.success) return { error: 'IR104' }
  // §48: Gratis only from a browser unlocked with the code, not just a hidden button.
  if (parsed.data.outcome === 'gratis' && !(await gratisUnlocked(admin.id))) return { error: 'forbidden' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_settle_pay_after', {
    p_booking_id: parsed.data.booking_id,
    p_outcome: parsed.data.outcome,
    ...(parsed.data.outcome === 'paid' ? { p_method: parsed.data.method } : {}),
  })
  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/money')
  revalidatePath('/admin/cash')
  return undefined
}
