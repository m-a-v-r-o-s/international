'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { sqlNull } from '@/lib/supabase/args'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { euroAmountSchema } from '@/lib/money'

export type FormState = { error?: ErrorKey; saved?: boolean } | undefined

const uuidSchema = z.string().uuid()

/**
 * A6 · The boss sets the charge and closes the item.
 *
 * admin_resolve_incident() is the only door, and not for convenience:
 * `incidents.charge` and `incidents.resolution` are withheld from
 * `authenticated` by column grant, so a direct update is refused for the admin
 * as flatly as for a rep. The RPC re-checks app.is_admin() itself and writes
 * through the audited table, so the amount lands in audit_log with actor,
 * before and after like every other write.
 *
 * A blank amount is a real answer — "seen, nothing to charge" — and is passed
 * through as null rather than coerced to zero, which would read on the record
 * as a charge of €0 that was actually decided.
 */
export async function resolveIncident(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const raw = String(formData.get('charge') ?? '').trim()
  const parsed = z.object({
    id: uuidSchema,
    charge: raw === '' ? z.null() : euroAmountSchema,
    resolution: z.string().trim().max(2000).optional().transform((v) => v || null),
  }).safeParse({
    id: formData.get('id'),
    charge: raw === '' ? null : raw,
    resolution: formData.get('resolution'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_resolve_incident', {
    p_id: parsed.data.id,
    p_charge: sqlNull(parsed.data.charge),
    p_resolution: sqlNull(parsed.data.resolution),
  })
  if (error) return { error: errorKey(error) }

  revalidatePath(`/admin/incidents/${parsed.data.id}`)
  revalidatePath('/admin/incidents')
  return { saved: true }
}

/**
 * Filters are a plain GET redirect, same shape as A5's, so the URL stays
 * shareable. Open/closed is the whole filter now — there was a type dropdown
 * beside it until 0030, when the six types became one free-form record.
 */
export async function filterIncidents(formData: FormData): Promise<void> {
  await requireAdmin()

  const state = z.enum(['open', 'resolved', 'all']).catch('open').parse(formData.get('state'))
  redirect(`/admin/incidents?${new URLSearchParams({ state }).toString()}`)
}
