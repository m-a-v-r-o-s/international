'use client'

import { useEffect, useRef } from 'react'
import { subscribeToPush } from './actions'

const TRIED_KEY = 'ir-push-auto-tried'

/**
 * A rep's push subscription is opt-in-always now, not a choice on screen
 * (settings/page.tsx no longer offers it to a rep at all — see 0027). This is
 * the mechanism that replaces the manual "Turn on for this device" button:
 * silent, no UI of its own, so there is nothing for a rep to see or decline.
 *
 * It cannot silently register a subscription out of nothing, though — a
 * browser will not hand out permission without the user having done
 * something on the page first (strictly required on iOS, and the safe
 * assumption everywhere else), so this waits for the first tap/click before
 * asking, exactly once per tab. If permission is already granted from a
 * previous device or session, it re-subscribes immediately with no wait,
 * since only the *asking* needs a gesture. Denied or unsupported browsers are
 * left alone, same as PushToggle.tsx: push is a convenience, never a gate.
 */
export function AutoPushSubscribe({ publicKey }: { publicKey: string | null }) {
  const attempted = useRef(false)

  useEffect(() => {
    if (!publicKey) return
    if (typeof navigator === 'undefined'
      || !('serviceWorker' in navigator)
      || !('PushManager' in window)) {
      return
    }
    if (Notification.permission === 'denied') return

    let cancelled = false

    async function subscribe(registration: ServiceWorkerRegistration) {
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      })
      const formData = new FormData()
      formData.set('subscription', JSON.stringify(sub.toJSON()))
      await subscribeToPush(undefined, formData)
    }

    async function attempt() {
      if (attempted.current) return
      attempted.current = true

      try {
        const registration = await navigator.serviceWorker.register('/sw.js')
        if (cancelled) return

        const existing = await registration.pushManager.getSubscription()
        if (existing) return

        if (Notification.permission === 'granted') {
          await subscribe(registration)
          return
        }

        // 'default': only reachable from here after a gesture (see below).
        const permission = await Notification.requestPermission()
        if (cancelled || permission !== 'granted') return
        await subscribe(registration)
      } catch {
        // Silent — see the module comment. Nothing here is a gate.
      }
    }

    if (Notification.permission === 'granted') {
      void attempt()
      return () => { cancelled = true }
    }

    // 'default': wait for the first tap/click in this tab, once, rather than
    // asking on load — a permission prompt nobody gestured for is one people
    // dismiss without reading, and dismissing it can stick as a soft "no".
    if (sessionStorage.getItem(TRIED_KEY)) return
    const onFirstInteraction = () => {
      sessionStorage.setItem(TRIED_KEY, '1')
      void attempt()
    }
    document.addEventListener('pointerdown', onFirstInteraction, { once: true })
    return () => {
      cancelled = true
      document.removeEventListener('pointerdown', onFirstInteraction)
    }
  }, [publicKey])

  return null
}
