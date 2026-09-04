'use client'

import { useLinkStatus } from 'next/link'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

/**
 * Never a silent freeze — the navigation half of it.
 *
 * SubmitButton.tsx already covers a form: press it and the button says so.
 * A tapped LINK said nothing at all. The browser stays on the old screen with
 * no indication anything happened until the whole next page has rendered, so a
 * rep who taps "Pickups" and sees the same screen for half a second taps it
 * again, and the boss reads the app as broken rather than busy.
 *
 * Why this is client-side rather than a `loading.tsx` alone: the service runs
 * with Railway's app sleeping on (deliberately, to keep the testing bill
 * down), so a tap can land on a container that has to start first. A
 * `loading.tsx` skeleton is streamed BY the server, so it cannot appear until
 * the server is answering — exactly the seconds that need covering most.
 * `useLinkStatus()` is pure client state and paints immediately, awake or not.
 * The two are a pair: this bar covers the wait for the first byte, the
 * skeleton covers the render after it. Both, or the gap simply moves.
 *
 * Why a bar at the top of the shell rather than a spinner inside the link:
 * the phone drawer closes over its own links the moment the page changes, and
 * a rep tapping a section in that drawer would be watching an indicator on a
 * panel that is sliding away. The bar is in the same place on every screen and
 * at both breakpoints.
 */

/**
 * Reports how many links are mid-navigation. A count rather than a boolean
 * because a `LinkProgress` unmounting mid-flight (the drawer closing) must not
 * clear a bar another link still owns — the count only reaches zero when every
 * pending link has either arrived or gone away.
 */
const NavProgressContext = createContext<((pending: boolean) => void) | null>(null)

export function NavProgressProvider({
  children, label,
}: {
  children: React.ReactNode
  /** Announced to a screen reader while a navigation is in flight. */
  label: string
}) {
  const [pendingCount, setPendingCount] = useState(0)

  const report = useCallback((pending: boolean) => {
    setPendingCount((n) => Math.max(0, n + (pending ? 1 : -1)))
  }, [])

  const active = pendingCount > 0

  return (
    <NavProgressContext.Provider value={report}>
      {/*
        `aria-live="polite"` on a container that is always present, with only
        the text inside it changing — announcing the arrival of the region
        itself is unreliable across screen readers.
      */}
      <div role="status" aria-live="polite" className="print:hidden">
        {active ? (
          <div className="ir-progress fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-brand-tint">
            <span aria-hidden="true" className="ir-progress-bar block h-full w-2/5 bg-brand" />
          </div>
        ) : null}
        <span className="sr-only">{active ? label : ''}</span>
      </div>
      {children}
    </NavProgressContext.Provider>
  )
}

/**
 * Rendered as a child of a `<Link>` — `useLinkStatus()` reads the pending
 * state of the nearest Link above it, so it only works from inside one. Draws
 * nothing itself; it reports that link's state up to the bar.
 */
export function LinkProgress() {
  const report = useContext(NavProgressContext)
  const { pending } = useLinkStatus()

  useEffect(() => {
    if (!pending || !report) return
    report(true)
    return () => report(false)
  }, [pending, report])

  return null
}
