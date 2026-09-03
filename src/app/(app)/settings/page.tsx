import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { SignOutButton } from '@/components/SignOutButton'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings')
  return { title: t('title') }
}

/**
 * R8 · Settings — language, PIN, sign out (docs/04-SCREENS.md R8).
 *
 * The PIN section came back with §38: a rep changes their own PIN again, so
 * this is where they reach it when nothing is forcing them to. The screen it
 * links to is the same one requireUnlocked() sends them to while they are still
 * holding a PIN the boss issued — one form, one action, one set of rules about
 * what a PIN may be, whether the rep chose to come or was sent.
 *
 * The boss's version of this screen — language plus account — lives at
 * /admin/settings, folded in alongside the company/legal settings so the
 * sidebar's single "Settings" entry is the only settings screen an admin ever
 * needs. An admin landing here (an old link, the
 * header's globe button) is sent straight there instead of seeing a second,
 * incomplete settings page.
 */
export default async function SettingsPage() {
  const staff = await requireUnlocked()
  if (staff.role === 'admin') redirect('/admin/settings')
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

      <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="pin-heading">
        <h2 id="pin-heading" className="text-[1.125rem] font-semibold">{t('pin')}</h2>
        <p className="text-[0.9375rem] text-ink-soft">{t('pinHelp')}</p>
        <Link href="/change-pin" className="ir-btn-quiet">{t('pinChange')}</Link>
      </section>

      <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="acct-heading">
        <h2 id="acct-heading" className="text-[1.125rem] font-semibold">{t('account')}</h2>
        <SignOutButton className="ir-btn-quiet">{tc('signOut')}</SignOutButton>
      </section>
    </div>
  )
}
