import 'server-only'

import { hash, verify } from '@node-rs/argon2'

/**
 * The device PIN, hashed with argon2id — the same treatment as a password, not
 * a fast hash. A four-digit PIN has a small keyspace, so the slow hash matters
 * and so does the rate limit on the unlock attempt that calls this.
 */
// @node-rs/argon2 defaults to argon2id; these are the OWASP-recommended
// parameters for it. Both hashing and verification must pass the same values.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 }

export const PIN_MIN = 4
export const PIN_MAX = 8

export function isWellFormedPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin)
}

export async function hashPin(pin: string): Promise<string> {
  return hash(pin, OPTIONS)
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  try {
    return await verify(stored, pin, OPTIONS)
  } catch {
    return false
  }
}
