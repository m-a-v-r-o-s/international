import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { vapidPublicKey } from '@/lib/push/keys'
import { NotificationPreferences } from './NotificationPreferences'
import { PushToggle } from './PushToggle'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings')
  return { title: t('title') }
}

/**
 * R8 · Settings — language, PIN, notifications, sign out
 * (docs/04-SCREENS.md R8). Complete as of this phase.
 *
 * Notifications are two separate things and the screen keeps them separate:
 * whether THIS DEVICE receives pushes at all — a browser permission and a
 * subscription that belong to the phone in the rep's hand — and which KINDS of
 * message this person wants anywhere. Turning off the evening reminder should
 * not mean unregistering the phone, and changing phones should not silently
 * forget what they chose.
 */
export default async function SettingsPage() {
  const staff = await requireUnlocked()
  const t = await getTranslations('settings')
  const tc = await getTranslations('common')
  const supabase = await supabaseServer()

  const { data } = await supabase
    .from('profiles')
    .select('notify_morning, notify_evening, notify_exceptions')
    .eq('id', staff.id)
    .maybeSingle()

  const prefs = {
    morning: (data as { notify_morning?: boolean } | null)?.notify_morning ?? true,
    evening: (data as { notify_evening?: boolean } | null)?.notify_evening ?? true,
    exceptions: (data as { notify_exceptions?: boolean } | null)?.notify_exceptions ?? true,
  }

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

      <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="notify-heading">
        <h2 id="notify-heading" className="text-[1.125rem] font-semibold">{t('notifications')}</h2>
        <PushToggle publicKey={vapidPublicKey()} />
        <hr className="border-line" />
        <NotificationPreferences role={staff.role} prefs={prefs} />
      </section>

      <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="acct-heading">
        <h2 id="acct-heading" className="text-[1.125rem] font-semibold">{t('account')}</h2>
        <a href="/signed-out" className="ir-btn-quiet">{tc('signOut')}</a>
      </section>
    </div>
  )
}
