'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { companySchema } from '@/lib/contract/company'
import { purgeLicenceImages } from '@/lib/retention/purge'
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
