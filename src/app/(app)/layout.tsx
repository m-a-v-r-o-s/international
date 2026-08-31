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

  /**
   * The admin's list is his eleven screens with the rep's appended under their
   * own heading — additive, never a mode to be in the wrong one of
   * (docs/01-DECISIONS.md §30 decision 4). Before this the admin branch linked
   * to none of them, which is why "even the boss makes bookings sometimes" was
   * not something the boss could do.
   *
   * `/` is deliberately not in the appended group. For an admin it is not a
   * Today screen at all — it is his landing card, and A1 Movements is his
   * morning screen — so listing it under "Today" would name it wrongly. The
   * logo links there for everyone regardless.
   */
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
        { href: '/admin/customers', label: ta('nav.customers') },
        { href: '/admin/audit', label: ta('nav.audit') },
        { href: '/admin/settings', label: ta('nav.settings') },
        { href: '/availability', label: tn('availability'), section: ta('nav.deskSection') },
        { href: '/bookings/new', label: tn('newBooking') },
        { href: '/bookings', label: tn('myBookings') },
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
        <div className={`mx-auto flex w-full ${shell} flex-nowrap items-center justify-between gap-3 px-5 py-3`}>
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
            <span className="hidden max-w-[16rem] truncate sm:inline">
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

        {/*
          The two things a rep does standing in front of a guest, on every
          screen rather than only from the one they happen to be on
          (docs/01-DECISIONS.md §30 decision 1). They are the same two acts for
          the boss, so both roles get both.

          A second row, not squeezed into the first: at 360px the top row is
          already a burger, a logo and three text links, and a phone call comes
          in while the rep is looking at something else. Full-width halves on a
          phone so each is a thumb-sized target; auto width from `sm` up.
        */}
        <div className={`mx-auto flex w-full ${shell} gap-2 px-5 pb-3`}>
          <Link href="/bookings/confirm" className="ir-btn-primary flex-1 sm:!w-auto sm:flex-none">
            {tn('quickBooking')}
          </Link>
          <Link href="/contracts/new" className="ir-btn-quiet flex-1 sm:!w-auto sm:flex-none">
            {tn('writeContract')}
          </Link>
        </div>
      </header>

      {/*
        The sidebar sits outside the centered `shell` container so it hugs the
        true left edge of the viewport on desktop, rather than the left edge
        of the centered content column.
      */}
      <div className="flex w-full flex-1 print:block">
        <SideNav items={items} label={navLabel} />
        <div className={`mx-auto flex w-full ${shell} flex-1 gap-6 px-5 print:max-w-none print:gap-0 print:px-0`}>
          <main
            id="main"
            className={`min-w-0 flex-1 py-6 print:max-w-none print:py-0 ${admin ? '' : 'max-w-3xl'}`}
          >
            {children}
          </main>
        </div>
      </div>

      <div className="print:hidden"><Footer /></div>
    </div>
  )
}
