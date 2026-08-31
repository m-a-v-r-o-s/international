'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

export type NavItem = { href: string; label: string }

/**
 * The app's section list, in the two places it appears: a standing column on a
 * desktop screen, and a drawer behind a burger on a phone. Both render the
 * same links from the same array, which the server layout builds per role —
 * the nav never decides who may see what, it only draws what it was handed.
 *
 * Only one of the two is ever in the accessibility tree: each is display:none
 * at the breakpoint the other owns, so a screen reader is not read eleven
 * links twice over.
 */

/**
 * The longest href the current path sits under, so /bookings/new marks "New
 * booking" rather than "My bookings", and /admin/cars/<id> still marks
 * "Fleet". Exact-match-only would leave every detail screen with nothing lit;
 * shortest-prefix would light the wrong row.
 */
function currentHref(items: NavItem[], pathname: string): string | undefined {
  return items
    .filter((i) => (i.href === '/'
      ? pathname === '/'
      : pathname === i.href || pathname.startsWith(`${i.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname()
  const current = currentHref(items, pathname)

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={item.href === current ? 'page' : undefined}
            className={`flex min-h-12 items-center rounded-field px-3.5 text-[1.0625rem]
                        transition-colors duration-150 ease-ui hover:bg-brand-tint ${
                          item.href === current
                            ? 'bg-brand-tint font-semibold text-brand'
                            : 'text-ink'
                        }`}
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** The desktop column. Sticks to the top so it survives a long table. */
export function SideNav({ items, label }: { items: NavItem[]; label: string }) {
  return (
    <nav
      aria-label={label}
      className="sticky top-0 hidden max-h-dvh w-60 shrink-0 self-start
                 overflow-y-auto py-6 lg:block print:hidden"
    >
      <NavList items={items} />
    </nav>
  )
}

/**
 * The phone drawer. It is a real <dialog> opened with showModal(), so the
 * focus trap, Escape, the inert background and the return of focus to the
 * burger are the browser's job rather than ARIA we would have to get right
 * ourselves — the same reasoning as Disclosure.tsx.
 */
export function NavDrawer({
  items, label, openLabel, closeLabel,
}: {
  items: NavItem[]
  label: string
  openLabel: string
  closeLabel: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pathname = usePathname()

  // A tapped link navigates without unmounting the layout, so nothing else
  // would close the drawer over the new page.
  useEffect(() => { dialog.current?.close() }, [pathname])

  // A tablet rotated into the desktop breakpoint hides this drawer in CSS but
  // would leave it open — and an open modal dialog holds the page inert, so
  // the sidebar it just revealed would be unclickable. Matches `lg`.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 64rem)')
    const close = () => { if (desktop.matches) dialog.current?.close() }
    desktop.addEventListener('change', close)
    return () => desktop.removeEventListener('change', close)
  }, [])

  return (
    <>
      <button
        type="button"
        aria-label={openLabel}
        onClick={() => dialog.current?.showModal()}
        className="-ml-2 flex size-11 items-center justify-center rounded-field
                   text-ink hover:bg-brand-tint lg:hidden print:hidden"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <dialog
        ref={dialog}
        aria-label={label}
        onClick={(e) => { if (e.target === dialog.current) dialog.current?.close() }}
        className="ir-drawer m-0 mr-auto h-dvh max-h-none w-72 max-w-[85vw] rounded-none
                   border-r border-line bg-surface p-0 backdrop:bg-ink/50 lg:hidden"
      >
        <div className="flex h-full flex-col gap-2 overflow-y-auto p-4">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="ir-btn-quiet !w-auto self-start !px-4"
          >
            {closeLabel}
          </button>
          <nav aria-label={label}>
            <NavList items={items} onNavigate={() => dialog.current?.close()} />
          </nav>
        </div>
      </dialog>
    </>
  )
}
