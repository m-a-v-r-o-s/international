import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireStaff } from '@/lib/auth/session'
import { Footer } from '@/components/Footer'
import { SetPinForm, UnlockForm } from './UnlockForms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('unlock')
  return { title: t('title') }
}

/**
 * The PIN gate: what a rep meets when a shift-length unlock has run out and
 * they reopen the app.
 *
 * Since §32 the PIN is also what they SIGN IN with, and the login screen opens
 * the unlock window itself when it verifies one — so a rep arriving here has
 * had a session for hours and is simply being asked again. The "choose a PIN"
 * half (SetPinForm) is now a fallback rather than a step in first use: the boss
 * issues the PIN when he creates the account, so `hasPin` is true from the
 * first sign-in onwards, and this only renders for a row whose `pin_hash` is
 * somehow null. It costs nothing to keep and is the only way back for that row.
 */
export default async function UnlockPage() {
  const staff = await requireStaff()
  if (staff.role === 'admin') redirect('/')

  const t = await getTranslations('unlock')

  return (
    <div className="flex min-h-dvh flex-col">
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-8">
        <header>
          <h1 className="text-[1.75rem] font-bold tracking-tight">
            {staff.hasPin ? t('title') : t('setTitle')}
          </h1>
        </header>

        <div className="ir-card p-5">
          {staff.hasPin ? <UnlockForm /> : <SetPinForm />}
        </div>

        <a href="/signed-out" className="text-center text-[0.9375rem] underline">
          {t('signOutInstead')}
        </a>
      </main>
      <Footer />
    </div>
  )
}
