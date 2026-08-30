import { describe, expect, test } from 'vitest'
import {
  isUnlocked, newDeviceId, readGate, signGate, UNLOCK_TTL_SECONDS, type Gate,
} from '../../src/lib/auth/gate'

const SECRET = 'test-secret-that-is-at-least-32-bytes-long!!'
const OTHER = 'a-completely-different-secret-of-the-same-length'

function gate(overrides: Partial<Gate> = {}): Gate {
  return {
    sub: '11111111-1111-1111-1111-111111111111',
    role: 'rep',
    unlockedUntil: Math.floor(Date.now() / 1000) + UNLOCK_TTL_SECONDS,
    ...overrides,
  }
}

describe('the gate cookie', () => {
  test('round-trips what was put in it', async () => {
    const value = await signGate(gate(), SECRET)
    expect(await readGate(value, SECRET)).toEqual(gate())
  })

  test('a tampered payload is rejected', async () => {
    const value = await signGate(gate({ role: 'rep' }), SECRET)
    const [payload, signature] = value.split('.')

    // Re-encode the payload as an admin and keep the original signature.
    const forged = Buffer.from(JSON.stringify(gate({ role: 'admin' })))
      .toString('base64url')
    expect(forged).not.toBe(payload)
    expect(await readGate(`${forged}.${signature}`, SECRET)).toBeNull()
  })

  test('a signature from another key is rejected', async () => {
    const value = await signGate(gate(), OTHER)
    expect(await readGate(value, SECRET)).toBeNull()
  })

  test('nonsense is rejected rather than throwing', async () => {
    for (const value of [undefined, '', 'no-dot', 'a.b', '...', 'x'.repeat(500)]) {
      expect(await readGate(value, SECRET)).toBeNull()
    }
  })

  test('an expired unlock is locked again', () => {
    expect(isUnlocked(gate())).toBe(true)
    expect(isUnlocked(gate({ unlockedUntil: Math.floor(Date.now() / 1000) - 1 }))).toBe(false)
    expect(isUnlocked(gate({ unlockedUntil: 0 }))).toBe(false)
    expect(isUnlocked(null)).toBe(false)
  })
})

describe('device ids', () => {
  test('are long, opaque and not repeated', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newDeviceId()))
    expect(ids.size).toBe(200)
    for (const id of ids) {
      expect(id.length).toBeGreaterThanOrEqual(16)
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})
