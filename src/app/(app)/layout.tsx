import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { Footer } from '@/components/Footer'

/**
 * Everything behind this layout requires an active, unlocked staff session.
 * That check is repeated inside every action and enforced again by RLS — a
 * layout is a convenience, never a control.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireUnlocked()
  const t = await getTranslations('common')
  const tr = await getTranslations('roles')

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-5 py-3">
          <Link href="/" className="text-[1.0625rem] font-bold text-brand">
            International Rentals
          </Link>
          <div className="flex items-center gap-3 text-[0.875rem] text-ink-soft">
            <span>
              {staff.fullName || tr(staff.role)}
            </span>
            <Link href="/settings" className="underline underline-offset-2 hover:text-ink">
              {t('language')}
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-5 py-6">{children}</main>
      <Footer />
    </div>
  )
}
