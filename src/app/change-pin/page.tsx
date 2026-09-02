import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireStaff } from '@/lib/auth/session'
import { Footer } from '@/components/Footer'
import { ChangePinForm } from './ChangePinForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('changePin')
  return { title: t('title') }
}

/**
 * Where a rep replaces the PIN the boss generated with one only they know
 * (docs/01-DECISIONS.md §38).
 *
 * It is reached two ways and reads differently in each. A rep still holding a
 * boss-issued PIN is SENT here by requireUnlocked() and will be sent here again
 * at every sign-in until they finish — so the copy explains why they are here
 * and the only link out is sign-out. A rep who has already chosen one arrives
 * from settings on purpose, and gets a way back.
 *
 * It sits outside (app)/ for the same reason /unlock does: that layout is what
 * redirects here, so a screen underneath it could only ever redirect to itself.
 * The route is still behind a session — src/proxy.ts sends an anonymous request
 * to /login and a locked rep to /unlock before either reaches this file, and
 * requireStaff() below is the check that actually decides.
 */
export default async function ChangePinPage() {
  const staff = await requireStaff()
  // The boss signs in with a one-time code and has no PIN (§21). Nothing here
  // applies to him, and an old link should not show him a form about one.
  if (staff.role === 'admin') redirect('/')

  // A row whose pin_hash is somehow null has no current PIN to prove, so this
  // form cannot be completed. /unlock's SetPinForm is the path for that case
  // and is the only place a PIN is ever set without proving the old one.
  if (!staff.hasPin) redirect('/unlock')

  const t = await getTranslations('changePin')
  const forced = staff.mustChangePin

  return (
    <div className="flex min-h-dvh flex-col">
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-8">
        <header>
          <h1 className="text-[1.75rem] font-bold tracking-tight">
            {forced ? t('title') : t('titleSettings')}
          </h1>
        </header>

        <div className="ir-card p-5">
          <ChangePinForm forced={forced} />
        </div>

        {/*
          A rep who is here because they were sent here cannot be given a "not
          now" — that is the decision, and a link back into the app would be
          the whole prompt undone. Signing out is not a way past it: the same
          screen is waiting at the next sign-in.
        */}
        <a href={forced ? '/signed-out' : '/settings'} className="text-center text-[0.9375rem] underline">
          {forced ? t('signOutInstead') : t('back')}
        </a>
      </main>
      <Footer />
    </div>
  )
}
