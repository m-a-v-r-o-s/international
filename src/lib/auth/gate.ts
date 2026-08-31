import { publicEnv } from '../env'
import { sha256Hex, timingSafeEqual } from '../hash'

/**
 * The gate cookie: who is signed in, in what role, and — for a rep — until when
 * the device is unlocked.
 *
 * It exists so the edge can turn a request away without a database round trip.
 * It is NOT the authority on anything: every server action and every query
 * re-checks the role in the database, and RLS re-checks it again underneath.
 * Treat this as a hint that is cryptographically hard to forge, not as
 * permission.
 */
export const GATE_COOKIE = 'ir_gate'
export const DEVICE_COOKIE = 'ir_device'

export type Gate = {
  sub: string
  role: 'admin' | 'rep'
  /** Epoch seconds. A rep must re-enter their PIN after this. */
  unlockedUntil: number
}

/** Long enough for a shift, short enough that a mislaid phone is not a session. */
export const UNLOCK_TTL_SECONDS = 12 * 60 * 60

/**
 * The admin has no PIN (docs/01-DECISIONS.md §21) and signs in on desktop and
 * phone at once, so their gate simply runs with the session cookie. Set long
 * so an admin who opens the app regularly is never forced back through login.
 */
export const ADMIN_GATE_TTL_SECONDS = 365 * 24 * 60 * 60

// Keyed by the secret rather than memoised once: a rotated SESSION_SECRET has
// to produce a different key, not silently reuse the first one this process saw.
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

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

export async function signGate(gate: Gate, secret: string): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(gate)))
  const key = await signingKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return `${payload}.${base64url(new Uint8Array(sig))}`
}

export async function readGate(value: string | undefined, secret: string): Promise<Gate | null> {
  if (!value) return null
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return null

  const key = await signingKey(secret)
  const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  if (!timingSafeEqual(base64url(new Uint8Array(expected)), signature)) return null

  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as Gate
    if (typeof parsed.sub !== 'string') return null
    if (parsed.role !== 'admin' && parsed.role !== 'rep') return null
    if (typeof parsed.unlockedUntil !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

export function isUnlocked(gate: Gate | null): boolean {
  return gate !== null && gate.unlockedUntil > Math.floor(Date.now() / 1000)
}

/**
 * A random, opaque identifier for this phone. Reps get one device
 * (docs/01-DECISIONS.md §1); this is what "one device" is measured against.
 * It identifies the browser install, nothing about the person.
 */
export function newDeviceId(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

/** A stable per-deployment bucket key for rate limiting by address. */
export async function emailBucket(prefix: string, email: string): Promise<string> {
  const { supabaseUrl } = publicEnv()
  return `${prefix}:${await sha256Hex(`${supabaseUrl}:${email.toLowerCase().trim()}`)}`
}
