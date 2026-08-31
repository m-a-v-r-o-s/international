'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { companySchema } from '@/lib/contract/company'
import { purgeLicenceImages } from '@/lib/retention/purge'
import { eraseCustomer } from '@/lib/customers/erase'
import { CLEAR_LEDGER_PHRASE } from '@/lib/customers/ledger'
import { allow } from '@/lib/rate-limit'

export type SettingsState = {
  error?: ErrorKey
  saved?: boolean
  /** What the purge actually did, so the screen reports rather than implies. */
  purged?: { deleted: number; bookings: number; drivers: number; refused: number }
} | undefined

/**
 * A10's contract half — the company details and the bilingual terms that the
 * agreement prints (docs/04-SCREENS.md, A10).
 *
 * `app_settings.company` is a jsonb column, so the whitelist has to be
 * explicit or the whole thing is a mass-assignment hole with extra steps:
 * companySchema names every field and Zod's `.parse()` strips anything else,
 * so a hand-crafted POST cannot smuggle a key into the column. The row itself
 * is protected by `app_settings_admin_update`, which re-checks app.is_admin()
 * in the database — requireAdmin() here is the second lock, not the only one.
 *
 * Nothing is defaulted, seeded or invented. The client has not sent the paper
 * agreement's terms or the company's legal details, and a plausible-looking
 * ΑΦΜ on a contract would be worse than a blank one.
 */
export async function saveCompanySettings(
  _prev: SettingsState, formData: FormData,
): Promise<SettingsState> {
  await requireAdmin()

  const parsed = companySchema.safeParse({
    legal_name: formData.get('legal_name') ?? '',
    address: formData.get('address') ?? '',
    vat_number: formData.get('vat_number') ?? '',
    phone: formData.get('phone') ?? '',
    email: formData.get('email') ?? '',
    insurer: formData.get('insurer') ?? '',
    insurance_policy: formData.get('insurance_policy') ?? '',
    terms_el: formData.get('terms_el') ?? '',
    terms_en: formData.get('terms_en') ?? '',
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('app_settings')
    .update({ company: parsed.data }).eq('id', 1)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/settings')
  return { saved: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// A10's remaining half (docs/04-SCREENS.md A10): the licence retention window
// and the default pick-up / drop-off windows. The contract half — company
// legal details and the bilingual terms — came forward to Phase 4 with the PDF
// that needs it and is above.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * docs/01-DECISIONS.md §25: licence images are auto-deleted after an
 * ADMIN-SET window, default 24 months after the rental ends. The bounds match
 * the column's own check constraint (1–120 months) rather than restating a
 * different opinion, and the value is what app.licence_retention_cutoff()
 * reads — so the number on this screen is the number the sweep applies.
 */
export async function saveRetentionSettings(
  _prev: SettingsState, formData: FormData,
): Promise<SettingsState> {
  await requireAdmin()

  const parsed = z.coerce.number().int().min(1).max(120)
    .safeParse(formData.get('licence_retention_months'))
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('app_settings')
    .update({ licence_retention_months: parsed.data }).eq('id', 1)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/settings')
  return { saved: true }
}

/**
 * §5's operating windows. They are stored as 'HH:MM-HH:MM' — the format the
 * check constraint in supabase/migrations/20260830170000_windows.sql enforces
 * — and drive two things: the time R3 pre-fills, and whether a booking's
 * actual times count as an override.
 */
const timeSchema = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export async function saveWindowSettings(
  _prev: SettingsState, formData: FormData,
): Promise<SettingsState> {
  await requireAdmin()

  const parsed = z.object({
    pickup_from: timeSchema,
    pickup_to: timeSchema,
    dropoff_from: timeSchema,
    dropoff_to: timeSchema,
  }).safeParse({
    pickup_from: formData.get('pickup_from'),
    pickup_to: formData.get('pickup_to'),
    dropoff_from: formData.get('dropoff_from'),
    dropoff_to: formData.get('dropoff_to'),
  })
  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.pickup_to < parsed.data.pickup_from) return { error: 'IR104' }
  if (parsed.data.dropoff_to < parsed.data.dropoff_from) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('app_settings').update({
    pickup_window: `${parsed.data.pickup_from}-${parsed.data.pickup_to}`,
    dropoff_window: `${parsed.data.dropoff_from}-${parsed.data.dropoff_to}`,
  }).eq('id', 1)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/settings')
  return { saved: true }
}

/**
 * Run the purge now.
 *
 * The scheduler (`npm run purge:licences`) is what normally does this; the
 * button exists so the boss can see the obligation being met, and so the whole
 * path is exercised during the pilot rather than first running unattended
 * months later. Both call the same function.
 *
 * It deletes real personal data and cannot be undone, so it is capped — a
 * stuck double-tap should not turn into a loop against the Storage API — and
 * it reports counts back rather than redirecting to a screen that merely looks
 * different.
 */
export async function runLicencePurge(
  _prev: SettingsState, formData: FormData,
): Promise<SettingsState> {
  const admin = await requireAdmin()

  const confirmed = formData.get('confirm') === 'yes'
  if (!confirmed) return { error: 'IR104' }

  if (!(await allow(`purge:${admin.id}`, 6, 3600))) return { error: 'rateLimited' }

  const outcome = await purgeLicenceImages({ actorId: admin.id })
  if (outcome.failed > 0) return { error: 'unknown' }

  revalidatePath('/admin/settings')
  return {
    purged: {
      deleted: outcome.deleted,
      bookings: outcome.bookings,
      drivers: outcome.driversMarked,
      refused: outcome.refused,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The Ψηφιακό πελατολόγιο — the customer ledger (docs/01-DECISIONS.md §25a)
//
// This section is not the same shape as the licence retention above it, and
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

  revalidatePath('/admin/settings')
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

  revalidatePath('/admin/settings')
  return { cleared: typeof data === 'number' ? data : 0 }
}
