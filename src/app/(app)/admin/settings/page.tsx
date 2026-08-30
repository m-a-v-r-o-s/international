import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import {
  contractReadiness, parseCompany, REQUIRED_FOR_CONTRACT, type RequiredCompanyField,
} from '@/lib/contract/company'
import { CompanyForm } from './CompanyForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminSettings')
  return { title: t('title') }
}

/**
 * A10 · Settings — the contract half.
 *
 * docs/04-SCREENS.md puts four things on A10: company legal details, the
 * bilingual contract terms, the licence retention window, and the default
 * pick-up and drop-off windows. Only the first two are here, and that is a
 * deliberate scope line rather than an oversight: the contract PDF has no
 * source for its own letterhead or its own terms without them, so they came
 * forward from Phase 5 with the contract. The retention window and the default
 * windows change nothing about a document a guest signs, and stay in Phase 5
 * with the rest of A10.
 *
 * The banner at the top is the honest state of the project: client items 5
 * (the paper agreement and its terms, both languages) and 7 (company legal
 * details) have not arrived, so until the boss pastes them in, this screen is
 * empty and every contract the app produces is stamped DRAFT.
 */
export default async function AdminSettingsPage() {
  await requireAdmin()
  const t = await getTranslations('adminSettings')
  const supabase = await supabaseServer()

  const { data } = await supabase.from('app_settings')
    .select('id, company').eq('id', 1).maybeSingle()

  const company = parseCompany(data?.company)
  const readiness = contractReadiness(company)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('intro')}</p>
      </div>

      {readiness.ready ? (
        <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">{t('ready')}</p>
      ) : (
        <div className="ir-notice border-warn bg-warn-tint text-warn" role="status">
          <p className="font-semibold">{t('notReadyTitle')}</p>
          <p className="mt-1">{t('notReadyBody')}</p>
          <ul className="mt-2 list-disc pl-5">
            {readiness.missing.map((field) => (
              <li key={field}>{t(`field.${field}` as `field.${RequiredCompanyField}`)}</li>
            ))}
          </ul>
          <p className="mt-2">
            {t('notReadyCount', {
              done: REQUIRED_FOR_CONTRACT.length - readiness.missing.length,
              total: REQUIRED_FOR_CONTRACT.length,
            })}
          </p>
        </div>
      )}

      <CompanyForm company={company} />
    </div>
  )
}
