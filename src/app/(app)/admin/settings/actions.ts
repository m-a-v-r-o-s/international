'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { companySchema } from '@/lib/contract/company'

export type SettingsState = { error?: ErrorKey; saved?: boolean } | undefined

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
