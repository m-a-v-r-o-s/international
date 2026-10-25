'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useId, useRef } from 'react'
import { animate, useMotionValue, type AnimationPlaybackControls } from 'motion/react'
import { appleSpring, project, rubberband, velocityTracker, prefersReducedMotion } from '@/lib/spring'
import { LinkProgress } from './NavProgress'

export type NavItem = {
  href: string
  label: string
  /**
   * Starts a new labelled group at this item. The admin's list is his own
   * screens followed by the rep screens he gained in §30, and running
   * the two together as one undifferentiated column would lose which is which
   * (docs/01-DECISIONS.md §30 decision 4).
   */
  section?: string
}

/**
 * The app's section list, in the two places it appears: a standing column on a
 * desktop screen, and a drawer behind a burger on a phone. Both render the
 * same links from the same array, which the server layout builds per role —
 * the nav never decides who may see what, it only draws what it was handed.
 *
 * Only one of the two is ever in the accessibility tree: each is display:none
 * at the breakpoint the other owns, so a screen reader is not read the whole
 * list twice over.
 */

/**
 * The longest href the current path sits under, so /bookings/new marks "New
 * booking" rather than "My bookings", and /admin/fleet/<id> still marks
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

/**
 * Consecutive items under one heading. A group whose first item carries no
 * `section` is unlabelled, which is what a rep's single flat list is.
 */
function grouped(items: NavItem[]): { section?: string; items: NavItem[] }[] {
  const out: { section?: string; items: NavItem[] }[] = []
  for (const item of items) {
    if (item.section || out.length === 0) out.push({ section: item.section, items: [] })
    out[out.length - 1]!.items.push(item)
  }
  return out
}

function NavList({
  items, onNavigate, variant = 'light',
}: {
  items: NavItem[]
  onNavigate?: () => void
  /** 'dark' is the rail's own navy background; the phone drawer stays 'light'
      even when it is opened from the navy mobile header. */
  variant?: 'light' | 'dark'
}) {
  const pathname = usePathname()
  // Matched against the WHOLE list, not group by group, so the longest prefix
  // still wins across a boundary.
  const current = currentHref(items, pathname)
  const uid = useId()
  const dark = variant === 'dark'

  return (
    <div className="flex flex-col gap-5">
      {grouped(items).map((group, index) => {
        const headingId = group.section ? `${uid}-${index}` : undefined
        return (
          <div key={group.section ?? index}>
            {group.section ? (
              <h2
                id={headingId}
                className={`mb-1 px-3.5 text-[0.75rem] font-semibold uppercase tracking-wide ${
                  dark ? 'text-brand-tint/70' : 'text-ink-soft'
                }`}
              >
                {group.section}
              </h2>
            ) : null}
            <ul className="flex flex-col gap-1" aria-labelledby={headingId}>
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    /*
                      Every screen in this list is dynamic — a booking board, a
                      cash sheet, live availability — and Next does not reuse a
                      prefetched dynamic segment for the navigation that
                      follows (`staleTimes.dynamic` defaults to 0). So the
                      default prefetch was rendering all fourteen of these
                      screens on the server, in full, on EVERY page view, and
                      then throwing every one of them away: fourteen wasted
                      renders and their auth round trips per screen the boss
                      opens, billed as compute, competing for a phone's
                      bandwidth with the tap he actually made.

                      Turning it off costs nothing that was being kept. Raising
                      `staleTimes.dynamic` instead would make the prefetch pay
                      — and would also serve a rep yesterday's board from cache
                      after another rep changed it, which is the one thing this
                      app must not do.
                    */
                    prefetch={false}
                    aria-current={item.href === current ? 'page' : undefined}
                    className={`flex min-h-12 items-center rounded-field px-3.5 text-[1.0625rem]
                                transition-colors duration-150 ease-ui ${
                                  dark
                                    ? item.href === current
                                      ? 'bg-brand-ink/15 font-semibold text-brand-ink'
                                      : 'text-brand-tint hover:bg-brand-ink/10 hover:text-brand-ink'
                                    : item.href === current
                                      ? 'bg-brand-tint font-semibold text-brand hover:bg-brand-tint'
                                      : 'text-ink hover:bg-brand-tint'
                                }`}
                  >
                    {item.label}
                    <LinkProgress />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The desktop rail. Sticks to the top so it survives a long table, and now
 * spans the full page height — header included, see the app layout — rather
 * than starting below it, carrying the logo up with it. `ir-rail` gives its
 * links a focus ring the global one (tuned for a light page) would render
 * invisible against navy — see globals.css.
 */
export function SideNav({
  items, label, logoAlt,
}: {
  items: NavItem[]
  label: string
  logoAlt: string
}) {
  return (
    <nav
      aria-label={label}
      className="ir-rail sticky top-0 hidden max-h-dvh w-60 shrink-0 flex-col
                 overflow-y-auto bg-brand-strong px-4 py-6 lg:flex print:hidden"
    >
      <Link
        href="/"
        prefetch={false}
        className="mb-6 inline-flex w-fit items-center rounded-field bg-surface px-2 py-1.5"
      >
        <img src="/logo-sm.webp" width={300} height={100} alt={logoAlt} className="h-16 w-auto" />
        <LinkProgress />
      </Link>
      <NavList items={items} variant="dark" />
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
  items, label, openLabel, closeLabel, dark = false,
}: {
  items: NavItem[]
  label: string
  openLabel: string
  closeLabel: string
  /** The trigger sits on the navy mobile header now, not always a white one. */
  dark?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pathname = usePathname()

  /*
    The drawer's position is a motion value in px: 0 is open, -width is shut.
    It is written straight to the element (no React render per frame) along
    with --p, the open fraction the backdrop's opacity follows.

    Gesture recipe (akosds-mobile-feel): 10px hysteresis before committing to
    the horizontal axis, 1:1 tracking, rubber band past the open edge, release
    velocity projected to decide open or shut, and the spring is interruptible
    (a finger down mid-flight stops it and carries on from where it is). No
    bounce: this is a tool used at speed, and nothing here delays a tap.
  */
  const x = useMotionValue(0)
  const width = useRef(288)
  const anim = useRef<AnimationPlaybackControls | null>(null)
  const goal = useRef<'open' | 'shut'>('shut')

  useEffect(() => {
    const paint = (v: number) => {
      const d = dialog.current
      if (!d) return
      d.style.transform = `translate3d(${v}px,0,0)`
      d.style.setProperty('--p', String(Math.min(1, Math.max(0, 1 + v / width.current))))
    }
    return x.on('change', paint)
  }, [x])

  const settle = useCallback((to: 'open' | 'shut', velocity = 0) => {
    const d = dialog.current
    if (!d) return
    goal.current = to
    anim.current?.stop()
    const target = to === 'open' ? 0 : -width.current
    const done = () => { if (to === 'shut') d.close() }
    if (prefersReducedMotion()) { x.set(target); done(); return }
    anim.current = animate(x, target, {
      type: 'spring', ...appleSpring(0.35, 0), velocity,
      restDelta: 0.5, restSpeed: 10,
      onComplete: done,
    })
  }, [x])

  const openDrawer = () => {
    const d = dialog.current
    if (!d) return
    d.showModal()
    width.current = d.offsetWidth
    x.jump(-width.current)
    settle('open')
  }
  const closeDrawer = () => { if (dialog.current?.open) settle('shut') }
  // No animation: for a route change or a rotation, where the page behind has
  // already moved on and the drawer should simply be gone.
  const hardClose = useCallback(() => {
    anim.current?.stop()
    dialog.current?.close()
  }, [])

  // A tapped link navigates without unmounting the layout, so nothing else
  // would close the drawer over the new page.
  useEffect(() => { hardClose() }, [pathname, hardClose])

  // A tablet rotated into the desktop breakpoint hides this drawer in CSS but
  // would leave it open — and an open modal dialog holds the page inert, so
  // the sidebar it just revealed would be unclickable. Matches `lg`.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 64rem)')
    const close = () => { if (desktop.matches) hardClose() }
    desktop.addEventListener('change', close)
    return () => desktop.removeEventListener('change', close)
  }, [hardClose])

  const dragged = useRef(false)
  // Drag to close along the axis it opens on.
  const drag = useRef<{
    id: number; x0: number; y0: number; from: number; live: boolean; moved: boolean
    vt: ReturnType<typeof velocityTracker>
  } | null>(null)

  // A catch that turned out to be a tap or a scroll: carry on to where it was headed.
  const resume = () => { if (anim.current?.state === 'paused') settle(goal.current) }

  const onPointerDown = (e: React.PointerEvent<HTMLDialogElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
    dragged.current = false
    // Caught mid-flight: freeze at the live value; a plain tap resumes below.
    const flying = anim.current && anim.current.state === 'running'
    if (flying) anim.current?.pause()
    const vt = velocityTracker()
    vt.add(x.get())
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, from: x.get(), live: false, moved: false, vt }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDialogElement>) => {
    const g = drag.current
    if (!g || g.id !== e.pointerId) return
    const dx = e.clientX - g.x0
    if (!g.live) {
      const dy = e.clientY - g.y0
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
      if (Math.abs(dy) > Math.abs(dx)) { // vertical: the list scrolls
        drag.current = null
        resume()
        return
      }
      g.live = true
      anim.current?.stop()
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    g.moved = true
    let v = g.from + dx
    if (v > 0) v = rubberband(v, width.current)
    if (v < -width.current) v = -width.current
    x.set(v)
    g.vt.add(v)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDialogElement>) => {
    const g = drag.current
    if (!g || g.id !== e.pointerId) return
    drag.current = null
    if (g.moved) dragged.current = true
    if (!g.live) {
      resume()
      return
    }
    const v = e.type === 'pointercancel' ? 0 : g.vt.get()
    const landing = x.get() + project(v)
    settle(landing > -width.current / 2 ? 'open' : 'shut', v)
  }
  // The click that ends a drag lands on the dialog itself, which would read as
  // a tap on the backdrop.
  const swallowDragClick = (e: React.MouseEvent) => {
    if (dragged.current) { e.stopPropagation(); e.preventDefault(); dragged.current = false }
  }
  return (
    <>
      <button
        type="button"
        aria-label={openLabel}
        onClick={openDrawer}
        className={`-ml-2 flex size-11 items-center justify-center rounded-field lg:hidden print:hidden ${
          dark ? 'ir-rail text-brand-ink hover:bg-brand-ink/10' : 'text-ink hover:bg-brand-tint'
        }`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <dialog
        ref={dialog}
        aria-label={label}
        // Esc goes through the same spring as every other way out.
        onCancel={(e) => { e.preventDefault(); closeDrawer() }}
        onClickCapture={swallowDragClick}
        onClick={(e) => { if (e.target === dialog.current) closeDrawer() }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="ir-drawer m-0 mr-auto h-dvh max-h-none w-72 max-w-[85vw] rounded-none
                   border-r border-line bg-surface p-0 lg:hidden"
      >
        <div className="flex h-full touch-pan-y flex-col gap-2 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={closeDrawer}
            className="ir-btn-quiet !w-auto self-start !px-4"
          >
            {closeLabel}
          </button>
          <nav aria-label={label}>
            <NavList items={items} onNavigate={closeDrawer} />
          </nav>
        </div>
      </dialog>
    </>
  )
}
