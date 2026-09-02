import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { Footer } from '@/components/Footer'
import { SideNav, NavDrawer, type NavItem } from '@/components/SideNav'
import { SignOutButton } from '@/components/SignOutButton'
import { vapidPublicKey } from '@/lib/push/keys'
import { getLocale } from '@/i18n/locale'
import { setLocale } from '@/lib/actions/locale'
import { AutoPushSubscribe } from './settings/AutoPushSubscribe'

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
  const locale = await getLocale()

  const admin = staff.role === 'admin'

  // The header's globe button used to open its own settings page — a second,
  // partial one for an admin (docs/04-SCREENS.md R8 vs A10) since the real
  // settings screen lives in the sidebar. It now just flips the language
  // directly, in one click, and the sidebar is the only place settings live.
  const nextLocale = locale === 'el' ? 'en' : 'el'
  // The button's label names the language it switches *to*, not the one
  // already applied — "English" while reading Greek, "Ελληνικά" while
  // reading English. Naming the current language read as an inert label,
  // not a control someone would tap.
  const nextLocaleLabel = nextLocale === 'el' ? t('greek') : t('english')

  // Matches the line-icon style already used for the drawer's burger icon.
  const globeIcon = (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 4 5.7 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.7-4-9s1.5-6.5 4-9Z" />
    </svg>
  )
  const signOutIcon = (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.75 8.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25h7.5A2.25 2.25 0 0 0 15.75 18v-2.25" />
      <path d="M9 12h11.25M17.25 8.25 21 12l-3.75 3.75" />
    </svg>
  )

  /**
   * The admin's list is the rep's three screens under "Front desk", then his
   * own under "Admin desk" — additive, never a mode to be in the wrong one of
   * (docs/01-DECISIONS.md §30 decision 4). Before this the admin branch linked
   * to none of the rep's, which is why "even the boss makes bookings
   * sometimes" was not something the boss could do. Front desk leads because
   * it is the screens used standing in front of a guest, reached fastest.
   *
   * `/` is deliberately not in either group. For an admin it is not a Today
   * screen at all — it is his landing card, and A1 Movements is his morning
   * screen — so listing it under "Front desk" would name it wrongly. The logo
   * links there for everyone regardless.
   */
  const items: NavItem[] = admin
    ? [
        { href: '/availability', label: tn('availability'), section: ta('nav.deskSection') },
        { href: '/bookings', label: tn('myBookings') },
        { href: '/incidents', label: tn('incidents') },
        { href: '/admin/movements', label: ta('nav.movements'), section: ta('nav.adminSection') },
        { href: '/admin/fleet', label: ta('nav.fleet') },
        { href: '/admin/categories', label: ta('nav.categories') },
        { href: '/admin/pricing', label: ta('nav.pricing') },
        { href: '/admin/bookings', label: ta('nav.bookings') },
        { href: '/admin/incidents', label: ta('nav.incidents') },
        { href: '/admin/cash', label: ta('nav.cash') },
        { href: '/admin/users', label: ta('nav.users') },
        { href: '/admin/customers', label: ta('nav.customers') },
        { href: '/admin/audit', label: ta('nav.audit') },
        { href: '/admin/settings', label: ta('nav.settings') },
      ]
    : [
        { href: '/', label: tn('today') },
        { href: '/pickups', label: tn('pickups') },
        { href: '/returns', label: tn('dropoffs') },
        { href: '/availability', label: tn('availability') },
        { href: '/bookings', label: tn('myBookings') },
        { href: '/incidents', label: tn('incidents') },
        { href: '/settings', label: tn('settings') },
      ]

  // The boss's screens are tables — the movements sheet, the fleet list, the
  // price grid — and they get the wider shell. A rep's stay at the reading
  // width they were designed at; the column simply sits in the margin.
  const shell = admin ? 'max-w-6xl' : 'max-w-5xl'
  const navLabel = admin ? ta('navLabel') : tn('primary')

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Silent — no toggle, no ask on screen. See AutoPushSubscribe.tsx. */}
      {admin ? null : <AutoPushSubscribe publicKey={vapidPublicKey()} />}
      {/*
        The rail carries the brand and the section list for the full height of
        the page — header included — so it sits outside both headers below
        rather than above them. On a screen too narrow for it (`lg:hidden`
        everywhere else in this file), the mobile header below stands in for
        it: same navy, same two acts, collapsed to a drawer behind a burger.
      */}
      <div className="flex w-full flex-1 print:block">
        <SideNav items={items} label={navLabel} logoAlt={tapp('logoAlt')} />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Desktop header: the rail already carries the logo and section
              list, so this is just identity and the two acts, in one line,
              pinned to the trailing edge. */}
          <header className="hidden border-b border-line bg-surface lg:block print:hidden">
            <div className="flex items-center justify-end gap-4 px-6 py-3">
              <span className="max-w-[16rem] truncate text-[0.875rem] text-ink-soft">
                {staff.fullName || tr(staff.role)}
              </span>
              <form action={setLocale} className="contents">
                <input type="hidden" name="locale" value={nextLocale} />
                <button type="submit" className="flex items-center gap-1 text-[0.875rem] text-ink-soft underline underline-offset-2 hover:text-ink">
                  {globeIcon}
                  {nextLocaleLabel}
                </button>
              </form>
              <SignOutButton className="flex items-center gap-1 text-[0.875rem] text-ink-soft underline underline-offset-2 hover:text-ink">
                {signOutIcon}
                {t('signOut')}
              </SignOutButton>
              <span className="h-6 w-px bg-line" aria-hidden="true" />
              <Link href="/contracts/new" className="ir-btn-quiet !w-auto">
                {tn('writeContract')}
              </Link>
              <Link href="/bookings/confirm" className="ir-btn-primary !w-auto">
                {tn('quickBooking')}
              </Link>
            </div>
          </header>

          {/*
            Mobile header: the rail is hidden below `lg`, so this carries the
            burger, the logo, and the two acts — the two things a rep does
            standing in front of a guest, on every screen rather than only
            from the one they happen to be on (docs/01-DECISIONS.md §30
            decision 1). Navy like the rail it stands in for.
          */}
          <header className="bg-brand-strong lg:hidden print:hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <NavDrawer
                  items={items}
                  label={navLabel}
                  openLabel={tn('open')}
                  closeLabel={tn('close')}
                  dark
                />
                <Link href="/" className="flex items-center rounded-field bg-surface px-2.5 py-1.5">
                  <img
                    src="/logo-sm.webp"
                    width={300}
                    height={100}
                    alt={tapp('logoAlt')}
                    className="h-12 w-auto"
                  />
                </Link>
              </div>
              <div className="flex items-center gap-2 text-[0.8125rem] text-brand-tint">
                <form action={setLocale} className="contents">
                  <input type="hidden" name="locale" value={nextLocale} />
                  <button type="submit" className="flex items-center gap-1 underline underline-offset-2 hover:text-brand-ink">
                    {globeIcon}
                    {nextLocaleLabel}
                  </button>
                </form>
                <SignOutButton className="flex items-center gap-1 underline underline-offset-2 hover:text-brand-ink">
                  {signOutIcon}
                  {t('signOut')}
                </SignOutButton>
              </div>
            </div>
            <div className="flex gap-2 px-4 pb-3">
              <Link href="/bookings/confirm" className="ir-btn-primary flex-1">
                {tn('quickBooking')}
              </Link>
              <Link
                href="/contracts/new"
                className="ir-btn flex-1 border border-brand-ink/40 bg-brand-ink/10 text-brand-ink hover:bg-brand-ink/20"
              >
                {tn('writeContract')}
              </Link>
            </div>
          </header>

          <div className={`mx-auto flex w-full ${shell} flex-1 px-5 print:max-w-none print:px-0`}>
            <main
              id="main"
              className={`min-w-0 flex-1 py-6 print:max-w-none print:py-0 ${admin ? '' : 'max-w-3xl'}`}
            >
              {children}
            </main>
          </div>
        </div>
      </div>

      <div className="print:hidden"><Footer /></div>
    </div>
  )
}
