import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings')
  return { title: t('title') }
}

/** R8 · Settings — language, PIN, sign out. The rest arrives with Phase 5. */
export default async function SettingsPage() {
  const staff = await requireUnlocked()
  const t = await getTranslations('settings')
  const tc = await getTranslations('common')

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>

      <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="lang-heading">
        <h2 id="lang-heading" className="text-[1.125rem] font-semibold">{t('language')}</h2>
        <p className="text-[0.9375rem] text-ink-soft">{t('languageHelp')}</p>
        <LanguageSwitcher />
      </section>

      {staff.role === 'rep' ? (
        <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="sec-heading">
          <h2 id="sec-heading" className="text-[1.125rem] font-semibold">{t('security')}</h2>
          <Link href="/unlock" className="ir-btn-quiet">{t('changePin')}</Link>
        </section>
      ) : null}

      <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="acct-heading">
        <h2 id="acct-heading" className="text-[1.125rem] font-semibold">{t('account')}</h2>
        <a href="/signed-out" className="ir-btn-quiet">{tc('signOut')}</a>
      </section>
    </div>
  )
}
