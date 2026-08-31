'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { eraseCustomer } from '@/lib/customers/erase'
import { CLEAR_LEDGER_PHRASE } from '@/lib/customers/ledger'
import { allow } from '@/lib/rate-limit'

// ─────────────────────────────────────────────────────────────────────────────
// The Ψηφιακό πελατολόγιο — the customer ledger (docs/01-DECISIONS.md §25a)
//
// A screen of its own since §30, having lived under A10 Settings until then.
// It is not the same shape as the licence retention it used to sit beside, and
// the difference is the whole of §25a. Licence images expire on a clock: an
// admin sets a window and the sweep enforces it whether anyone is watching or
// not. The customer ledger, by the owner's explicit decision, has NO clock.
// Nothing ever leaves it on its own.
//
// That makes these two actions the entire retention mechanism for a store of
// names, dates of birth and licence numbers, so they are held to the standard
// that implies: erase-one has to work every time a guest asks, clear-all has
// to be genuinely reachable rather than a button nobody dares press, and
// neither may be possible to trigger by a mis-tap. Everything below follows
// from that.
// ─────────────────────────────────────────────────────────────────────────────

export type LedgerState = {
  error?: ErrorKey
  /** Rows removed by a clear-all, so the screen reports rather than implies. */
  cleared?: number
  /** One guest erased on request, and whether their photos went with them. */
  erased?: { imagesDeleted: number }
  results?: LedgerMatch[]
  searched?: boolean
} | undefined

export type LedgerMatch = {
  id: string
  name: string
  lastSeenAt: string
  hasImages: boolean
}

/**
 * Finding the person who asked to be forgotten.
 *
 * An admin already holds SELECT on public.customers — they can see every
 * booking in the company, so a ledger built out of those bookings tells them
 * nothing new. This is therefore an ordinary filtered read and not another
 * security-definer function: the policy (customers_admin_select) is the
 * control, and a rep reaching this action is refused by requireAdmin() and
 * then again by the policy.
 *
 * It searches on the phone number OR the name, because a guest writing in to
 * ask for erasure will give one or the other and rarely both.
 */
export async function searchCustomerLedger(
  _prev: LedgerState, formData: FormData,
): Promise<LedgerState> {
  await requireAdmin()

  const parsed = z.string().trim().min(2).max(64).safeParse(formData.get('query'))
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  // `%` and `_` are wildcards to LIKE, so an unescaped query is a way to match
  // the whole table one character at a time. Escaped here rather than stripped,
  // so a name that legitimately contains one still finds itself.
  const term = parsed.data.replace(/[%_\\]/g, (c) => `\\${c}`)

  const { data, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, phone_e164, last_seen_at, licence_front_path')
    .or(`phone_e164.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
    .order('last_seen_at', { ascending: false })
    .limit(20)

  if (error) return { error: errorKey(error) }

  return {
    searched: true,
    results: (data ?? []).map((row) => ({
      id: row.id,
      name: [`${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(), row.phone_e164]
        .filter(Boolean).join(' · '),
      lastSeenAt: row.last_seen_at,
      hasImages: row.licence_front_path !== null,
    })),
  }
}

/**
 * Right to erasure, one guest (GDPR Art. 17).
 *
 * Deletes the ledger row, its consent links, and the guest's licence
 * photographs — the last through the Storage API, because removing the
 * metadata row would leave the photograph in the bucket and mark the
 * obligation done (src/lib/customers/erase.ts).
 *
 * It deliberately does NOT delete their bookings. Those are held under a
 * different obligation, §25 already says the booking record and the typed
 * licence number are retained, and quietly deleting accounting records because
 * someone emailed would be its own problem. The privacy policy says exactly
 * this, in these words, so nobody is promised more than they get.
 */
export async function eraseLedgerCustomer(
  _prev: LedgerState, formData: FormData,
): Promise<LedgerState> {
  const admin = await requireAdmin()

  const parsed = z.string().uuid().safeParse(formData.get('customer_id'))
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const outcome = await eraseCustomer(supabase, parsed.data, admin.id)
  if (!outcome.ok) return { error: outcome.reason }

  revalidatePath('/admin/customers')
  return { erased: { imagesDeleted: outcome.imagesDeleted } }
}

/**
 * Emptying the ledger.
 *
 * THREE CONFIRMATIONS, and they are three because the owner asked for three,
 * having chosen a store with no automatic expiry: this button is the only
 * thing standing between "we keep customers as long as we find useful" and
 * "we kept them for ever because nobody remembered". It needs to be pressable
 * on purpose and impossible to press by accident, which are not the same
 * requirement and are why one big scary dialog would not do.
 *
 *   1. an acknowledgement of what is about to go, with the count in it;
 *   2. a typed phrase, which a mis-tap cannot produce;
 *   3. an acknowledgement that it does not come back.
 *
 * All three are re-checked in public.admin_clear_customer_ledger() as well.
 * A confirmation that exists only in a form is a confirmation that a POST
 * skips.
 */
export async function clearCustomerLedger(
  _prev: LedgerState, formData: FormData,
): Promise<LedgerState> {
  const admin = await requireAdmin()

  const understood = formData.get('understood') === 'yes'
  const irreversible = formData.get('irreversible') === 'yes'
  const confirm = String(formData.get('confirm') ?? '').trim()

  if (!understood || !irreversible || confirm !== CLEAR_LEDGER_PHRASE) return { error: 'IR104' }

  // The same cap the licence purge carries. A destructive admin action should
  // not be loopable, however sure the person pressing it is.
  if (!(await allow(`ledgerclear:${admin.id}`, 3, 3600))) return { error: 'rateLimited' }

  const supabase = await supabaseServer()
  const { data, error } = await supabase.rpc('admin_clear_customer_ledger', {
    p_confirm: confirm,
    p_understood: understood,
    p_irreversible: irreversible,
  })
  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/customers')
  return { cleared: typeof data === 'number' ? data : 0 }
}
