import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { Footer } from '@/components/Footer'
import { SideNav, NavDrawer, type NavItem } from '@/components/SideNav'

/**
 * Everything behind this layout requires an active, unlocked staff session.
 * That check is repeated inside every action and enforced again by RLS — a
 * layout is a convenience, never a control. The same goes for the section list
 * below: it is drawn from the role, but nothing is protected by being left out
 * of it. A rep who types /admin/pricing is stopped by requireAdmin() and then
 * by RLS, not by the absence of a link.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireUnlocked()
  const t = await getTranslations('common')
  const tr = await getTranslations('roles')
  const tn = await getTranslations('nav')
  const ta = await getTranslations('admin')
  const tapp = await getTranslations('app')

  const admin = staff.role === 'admin'

  const items: NavItem[] = admin
    ? [
        { href: '/admin/movements', label: ta('nav.movements') },
        { href: '/admin/fleet-board', label: ta('nav.fleetBoard') },
        { href: '/admin/cars', label: ta('nav.cars') },
        { href: '/admin/categories', label: ta('nav.categories') },
        { href: '/admin/pricing', label: ta('nav.pricing') },
        { href: '/admin/bookings', label: ta('nav.bookings') },
        { href: '/admin/exceptions', label: ta('nav.exceptions') },
        { href: '/admin/users', label: ta('nav.users') },
        { href: '/admin/hotels', label: ta('nav.hotels') },
        { href: '/admin/audit', label: ta('nav.audit') },
        { href: '/admin/settings', label: ta('nav.settings') },
      ]
    : [
        { href: '/', label: tn('today') },
        { href: '/availability', label: tn('availability') },
        { href: '/bookings/new', label: tn('newBooking') },
        { href: '/bookings', label: tn('myBookings') },
        { href: '/settings', label: tn('settings') },
      ]

  // The boss's screens are tables — the movements sheet, the fleet board, the
  // price grid — and they get the wider shell. A rep's stay at the reading
  // width they were designed at; the column simply sits in the margin.
  const shell = admin ? 'max-w-6xl' : 'max-w-5xl'
  const navLabel = admin ? ta('navLabel') : tn('primary')

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface print:hidden">
        <div className={`mx-auto flex w-full ${shell} items-center justify-between gap-3 px-5 py-3`}>
          <div className="flex min-w-0 items-center gap-2">
            <NavDrawer
              items={items}
              label={navLabel}
              openLabel={tn('open')}
              closeLabel={tn('close')}
            />
            <Link href="/" className="flex items-center">
              {/* Fixed intrinsic size, so the header never reflows around it
                  once the image arrives. */}
              <img
                src="/logo-sm.webp"
                width={400}
                height={64}
                alt={tapp('logoAlt')}
                className="h-7 w-auto sm:h-8"
              />
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-[0.875rem] text-ink-soft">
            <span className="hidden sm:inline">
              {staff.fullName || tr(staff.role)}
            </span>
            <Link href="/settings" className="underline underline-offset-2 hover:text-ink">
              {t('language')}
            </Link>
            <a href="/signed-out" className="underline underline-offset-2 hover:text-ink">
              {t('signOut')}
            </a>
          </div>
        </div>
      </header>

      <div className={`mx-auto flex w-full ${shell} flex-1 gap-6 px-5 print:max-w-none print:gap-0 print:px-0`}>
        <SideNav items={items} label={navLabel} />
        <main
          id="main"
          className={`min-w-0 flex-1 py-6 print:max-w-none print:py-0 ${admin ? '' : 'max-w-3xl'}`}
        >
          {children}
        </main>
      </div>

      <div className="print:hidden"><Footer /></div>
    </div>
  )
}
