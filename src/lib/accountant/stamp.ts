import 'server-only'

import { serverEnv } from '../env'
import { timingSafeEqual } from '../hash'

/**
 * A signed "this form was rendered at" stamp, and the whole of the bot
 * protection on /accountant-questionnaire beyond the rate limiter.
 *
 * docs/03-SECURITY.md and the standing profile both require bot protection on
 * every public form. There is no captcha here and there deliberately is not
 * one: `src/proxy.ts` serves a strict CSP with `script-src 'self'
 * 'nonce-…' 'strict-dynamic'` and no third-party origin, so hCaptcha or
 * Turnstile would need the policy widened for one page. Widening a CSP that
 * protects a rep's session, to make one form slightly harder to spam, is the
 * wrong trade.
 *
 * What this gives instead, together with the honeypot field and the per-IP
 * bucket in the action:
 *
 *   · A submission cannot arrive without a form having been SERVED first, and
 *     served by us. A scripted POST straight at the action has no valid stamp.
 *   · A form cannot be submitted in under MIN_SECONDS. Nobody reads seventeen
 *     questions in four seconds; a script fills them instantly.
 *   · A stamp cannot be reused for days. It expires, so a harvested page is
 *     not a reusable ticket.
 *
 * It is not proof of a human and is not claimed to be. It raises the cost from
 * "POST in a loop" to "drive a browser, wait, and burn an IP", which is the
 * right amount of friction for a form one accountant fills in once.
 *
 * HMAC over the timestamp with SESSION_SECRET, the same key the gate cookie
 * uses. Same reasoning as src/lib/auth/gate.ts: keyed per secret so a rotated
 * SESSION_SECRET really invalidates what the old one signed.
 */
const MIN_SECONDS = 5
const MAX_SECONDS = 6 * 60 * 60

const keys = new Map<string, Promise<CryptoKey>>()

function signingKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret)
  if (!key) {
    key = crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    keys.set(secret, key)
  }
  return key
}

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function mac(payload: string, secret: string): Promise<string> {
  const key = await signingKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return base64url(new Uint8Array(sig))
}

/** Called when the page renders. The value goes into a hidden field. */
export async function issueStamp(): Promise<string> {
  const { sessionSecret } = serverEnv()
  const issued = String(Math.floor(Date.now() / 1000))
  return `${issued}.${await mac(issued, sessionSecret)}`
}

export type StampVerdict = 'ok' | 'tooFast' | 'invalid'

export async function verifyStamp(value: unknown): Promise<StampVerdict> {
  if (typeof value !== 'string') return 'invalid'

  const [issued, signature] = value.split('.')
  if (!issued || !signature || !/^\d{1,12}$/.test(issued)) return 'invalid'

  const { sessionSecret } = serverEnv()
  if (!timingSafeEqual(await mac(issued, sessionSecret), signature)) return 'invalid'

  const age = Math.floor(Date.now() / 1000) - Number(issued)
  // A negative age means a clock moved or a stamp was minted elsewhere.
  if (age < 0 || age > MAX_SECONDS) return 'invalid'
  if (age < MIN_SECONDS) return 'tooFast'

  return 'ok'
}
