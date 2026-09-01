import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { SignOutButton } from '@/components/SignOutButton'
import { vapidPublicKey } from '@/lib/push/keys'
import { NotificationPreferences } from './NotificationPreferences'
import { PushToggle } from './PushToggle'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings')
  return { title: t('title') }
}

/**
 * R8 · Settings — language, notifications (admin only), sign out
 * (docs/04-SCREENS.md R8).
 *
 * A rep has neither a PIN-change nor a notifications section here: only the
 * boss issues or changes a rep's PIN, and a rep's notifications are always on
 * rather than a preference — see setPin()'s first-use guard in
 * src/app/unlock/actions.ts and the notify_morning/notify_evening clamp in
 * app.profiles_before_write().
 *
 * For the boss, notifications stay two separate things: whether THIS DEVICE
 * receives pushes at all — a browser permission and subscription that belong
 * to the phone in hand — and which KINDS of message they want anywhere.
 */
export default async function SettingsPage() {
  const staff = await requireUnlocked()
  const t = await getTranslations('settings')
  const tc = await getTranslations('common')
  const supabase = await supabaseServer()

  const { data } = await supabase
    .from('profiles')
    .select('notify_exceptions')
    .eq('id', staff.id)
    .maybeSingle()

  const exceptions = (data as { notify_exceptions?: boolean } | null)?.notify_exceptions ?? true

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>

      <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="lang-heading">
        <h2 id="lang-heading" className="text-[1.125rem] font-semibold">{t('language')}</h2>
        <p className="text-[0.9375rem] text-ink-soft">{t('languageHelp')}</p>
        <LanguageSwitcher />
      </section>

      {staff.role === 'admin' ? (
        <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="notify-heading">
          <h2 id="notify-heading" className="text-[1.125rem] font-semibold">{t('notifications')}</h2>
          <PushToggle publicKey={vapidPublicKey()} />
          <hr className="border-line" />
          <NotificationPreferences exceptions={exceptions} />
        </section>
      ) : null}

      <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="acct-heading">
        <h2 id="acct-heading" className="text-[1.125rem] font-semibold">{t('account')}</h2>
        <SignOutButton className="ir-btn-quiet">{tc('signOut')}</SignOutButton>
      </section>
    </div>
  )
}
