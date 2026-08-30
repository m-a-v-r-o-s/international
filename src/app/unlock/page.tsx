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
 * The PIN gate. A rep signs in with a password once and then reopens the app
 * with a PIN (docs/01-DECISIONS.md §21) — so this screen is both "choose one"
 * and "enter it", depending on whether they have one yet.
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
