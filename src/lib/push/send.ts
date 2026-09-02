import 'server-only'

import webpush from 'web-push'
import { supabaseAdmin } from '../supabase/admin'
import { logSecurityEvent } from '../rate-limit'
import { vapidDetails } from './keys'

/**
 * Sending a push (docs/01-DECISIONS.md §22).
 *
 * The service role again, on the server's own behalf — the same category as
 * the rate limiter, the security log and the retention job. It has to be:
 * `push_own` restricts `push_subscriptions` to the row's owner, so no session
 * can read the devices of the people a notification is FOR, which is the
 * correct policy and the reason the sender is not a user-facing query.
 *
 * Push is optional machinery. With no VAPID keys nothing here throws — every
 * function reports that push is not configured and the scheduled jobs exit
 * cleanly, exactly as the mailer does with no SMTP. A deployment without push
 * is a deployment without push, not a broken one.
 */
export type PushMessage = {
  title: string
  body: string
  url: string
  tag: string
  lang: string
}

export type Target = {
  profile_id: string
  lang: string
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export type SendOutcome = {
  configured: boolean
  sent: number
  /** Endpoints the push service said were gone; their rows are removed. */
  expired: number
  failed: number
}

/** HTTP 404/410 from a push service means the browser retired that endpoint. */
const GONE = new Set([404, 410])

let configured: ReturnType<typeof vapidDetails> | null | undefined

function ensureVapid(): boolean {
  if (configured === undefined) {
    configured = vapidDetails()
    if (configured) {
      webpush.setVapidDetails(configured.subject, configured.publicKey, configured.privateKey)
    }
  }
  return configured !== null
}

export async function targetsFor(kind: 'morning' | 'evening' | 'incidents'): Promise<Target[]> {
  const { data } = await supabaseAdmin().rpc('push_targets', { p_kind: kind })
  return (data ?? []) as Target[]
}

/**
 * Sends one message to one device.
 *
 * A dead endpoint is deleted rather than retried: a browser that has been
 * reinstalled leaves its old endpoint answering 410 for ever, and a scheduled
 * job that retries it twice a day is a slow leak of both time and log lines.
 */
export async function sendTo(target: Target, message: PushMessage): Promise<'sent' | 'expired' | 'failed'> {
  if (!ensureVapid()) return 'failed'

  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: target.keys },
      JSON.stringify(message),
      { TTL: 60 * 60 * 6 },   // a morning summary is worthless by the evening
    )
    return 'sent'
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    if (status !== undefined && GONE.has(status)) {
      await supabaseAdmin().rpc('drop_push_subscription', { p_endpoint: target.endpoint })
      return 'expired'
    }
    return 'failed'
  }
}

/**
 * Sends one message per target, where the message may differ per person —
 * a rep's morning summary is their own movements in their own language.
 *
 * Returning null from `build` skips that person, which is how "you have
 * nothing on today" becomes silence rather than an empty notification.
 */
export async function sendEach(
  targets: readonly Target[],
  build: (target: Target) => Promise<PushMessage | null> | PushMessage | null,
): Promise<SendOutcome> {
  if (!ensureVapid()) return { configured: false, sent: 0, expired: 0, failed: 0 }

  const outcome: SendOutcome = { configured: true, sent: 0, expired: 0, failed: 0 }

  for (const target of targets) {
    const message = await build(target)
    if (!message) continue

    const result = await sendTo(target, message)
    outcome[result === 'sent' ? 'sent' : result === 'expired' ? 'expired' : 'failed']++
  }

  // Counts only. Never an endpoint, never a payload — a push body carries a
  // guest's name and a plate (docs/03-SECURITY.md, "Logging").
  if (outcome.sent > 0 || outcome.expired > 0 || outcome.failed > 0) {
    await logSecurityEvent({
      kind: 'push_sent',
      detail: { sent: outcome.sent, expired: outcome.expired, failed: outcome.failed },
    })
  }

  return outcome
}

/** Test seam: the VAPID configuration is memoised, and a test may change it. */
export function resetVapidCache(): void {
  configured = undefined
}
