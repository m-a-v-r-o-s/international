'use client'

import { useActionState, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { subscribeToPush, unsubscribeFromPush, type NotifyState } from './actions'

/**
 * Registering this device for push (docs/01-DECISIONS.md §22).
 *
 * THE SERVICE WORKER IS REGISTERED FROM HERE, from a component Next bundles
 * and stamps with the CSP nonce, and never from an inline <script>.
 * src/proxy.ts sets `script-src 'self' 'nonce-…' 'strict-dynamic'` with no
 * `unsafe-eval` in production, so an inline registration would need the nonce
 * threaded to it by hand and would work in `next dev` while failing silently
 * on Railway — the exact failure mode this phase was told to expect.
 * `worker-src 'self' blob:` already permits the worker itself.
 *
 * Everything degrades to a sentence. An iOS browser with no PushManager, a
 * desktop with notifications blocked, a deployment with no VAPID key: each
 * says what is true and offers nothing that cannot work. Nothing here is a
 * gate in front of anything — a rep with push off uses the whole app.
 */
type State =
  | 'checking'
  | 'unsupported'      // no service worker or no PushManager in this browser
  | 'unconfigured'     // the server has no VAPID public key
  | 'denied'           // the person said no, and only they can undo it
  | 'off'
  | 'on'

export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const t = useTranslations('settings')
  const te = useTranslations('errors')

  const [state, setState] = useState<State>('checking')
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<string | null>(null)

  const [subState, subscribeAction] = useActionState<NotifyState, FormData>(
    subscribeToPush, undefined)
  const [unsubState, unsubscribeAction] = useActionState<NotifyState, FormData>(
    unsubscribeFromPush, undefined)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      if (!publicKey) return setState('unconfigured')
      if (typeof navigator === 'undefined'
        || !('serviceWorker' in navigator)
        || !('PushManager' in window)) {
        return setState('unsupported')
      }
      if (Notification.permission === 'denied') return setState('denied')

      try {
        const registration = await navigator.serviceWorker.register('/sw.js')
        const existing = await registration.pushManager.getSubscription()
        if (cancelled) return

        if (existing) {
          setEndpoint(existing.endpoint)
          setState('on')
        } else {
          setState('off')
        }
      } catch {
        if (!cancelled) setState('unsupported')
      }
    })()

    return () => { cancelled = true }
  }, [publicKey])

  /**
   * Asking permission has to happen in the click handler: browsers require a
   * user gesture, and a prompt that appears on page load is one people dismiss
   * without reading. The server action then does the storing, so the
   * subscription arrives over the same authenticated channel as every other
   * write rather than through an endpoint of its own.
   */
  async function enable(form: HTMLFormElement) {
    if (!publicKey) return

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setState(permission === 'denied' ? 'denied' : 'off')
      return
    }

    const registration = await navigator.serviceWorker.register('/sw.js')
    const existing = await registration.pushManager.getSubscription()
    const sub = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    })

    setSubscription(JSON.stringify(sub.toJSON()))
    setEndpoint(sub.endpoint)
    setState('on')

    // The hidden field is populated above; submit once React has flushed it.
    queueMicrotask(() => form.requestSubmit())
  }

  async function disable() {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = await registration?.pushManager.getSubscription()
    await sub?.unsubscribe()
    setState('off')
  }

  const error = subState?.error ?? unsubState?.error

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
          {te(error)}
        </p>
      ) : null}

      <p className="text-[0.9375rem] text-ink-soft" role="status">
        {state === 'checking' ? t('pushChecking')
          : state === 'unsupported' ? t('pushUnsupported')
          : state === 'unconfigured' ? t('pushUnconfigured')
          : state === 'denied' ? t('pushDenied')
          : state === 'on' ? t('pushOn')
          : t('pushOff')}
      </p>

      {state === 'off' ? (
        <form
          action={subscribeAction}
          onSubmit={(e) => {
            // The first submit only asks the browser; enable() re-submits once
            // there is a subscription to send.
            if (!subscription) {
              e.preventDefault()
              void enable(e.currentTarget)
            }
          }}
        >
          <input type="hidden" name="subscription" value={subscription ?? ''} />
          <SubmitButton label={t('pushEnable')} variant="quiet" />
        </form>
      ) : null}

      {state === 'on' && endpoint ? (
        <form
          action={unsubscribeAction}
          onSubmit={() => { void disable() }}
        >
          <input type="hidden" name="endpoint" value={endpoint} />
          <SubmitButton label={t('pushDisable')} variant="quiet" />
        </form>
      ) : null}
    </div>
  )
}
