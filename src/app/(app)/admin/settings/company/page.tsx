import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import {
  contractReadiness, parseCompany, REQUIRED_FOR_CONTRACT, type RequiredCompanyField,
} from '@/lib/contract/company'
import { CompanyForm } from '../CompanyForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminSettings')
  return { title: t('companyCardTitle') }
}

/**
 * A10's contract half, on its own screen. It used to sit inline on A10
 * Settings (see the note at the top of ../page.tsx); the boss found that page
 * too long to scan, so Settings now links here instead of embedding the form.
 *
 * The banner at the top is the honest state of the project: until the boss
 * pastes in the company's legal details and the paper agreement's terms,
 * every contract the app produces is stamped DRAFT.
 */
export default async function AdminCompanySettingsPage() {
  await requireAdmin()
  const t = await getTranslations('adminSettings')
  const supabase = await supabaseServer()

  const { data } = await supabase.from('app_settings')
    .select('company').eq('id', 1).maybeSingle()

  const company = parseCompany(data?.company)
  const readiness = contractReadiness(company)

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/settings" className="text-[0.9375rem] text-brand underline-offset-2 hover:underline">
        ← {t('title')}
      </Link>

      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('companyCardTitle')}</h1>
        <p className="text-ink-soft">{t('companyCardDesc')}</p>
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
