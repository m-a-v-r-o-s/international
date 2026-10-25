import 'server-only'

import { cookies } from 'next/headers'
import { isProduction, serverEnv } from '../env'
import { isUnlocked, readGate, signGate } from './gate'

/**
 * The gratis unlock (docs/01-DECISIONS.md §48): a short-lived signed cookie,
 * set only after the 4-digit code checks out on the server. Shaped like the
 * gate cookie and signed the same way, but under its own key, so the
 * year-long admin gate can never be replayed as this one.
 */
export const GRATIS_COOKIE = 'ir_gratis'
export const GRATIS_TTL_SECONDS = 30 * 60

const key = () => `${serverEnv().sessionSecret}:gratis`

export async function gratisUnlocked(staffId: string): Promise<boolean> {
  const gate = await readGate((await cookies()).get(GRATIS_COOKIE)?.value, key())
  return gate?.sub === staffId && isUnlocked(gate)
}

export async function openGratis(staffId: string): Promise<void> {
  const value = await signGate(
    { sub: staffId, role: 'admin', unlockedUntil: Math.floor(Date.now() / 1000) + GRATIS_TTL_SECONDS },
    key())
  ;(await cookies()).set(GRATIS_COOKIE, value, {
    httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/', maxAge: GRATIS_TTL_SECONDS,
  })
}

export async function closeGratis(): Promise<void> {
  ;(await cookies()).delete(GRATIS_COOKIE)
}

/** 0000, 7777, 1234, 9876 and the like: the first codes anyone would try. */
export function isObviousCode(code: string): boolean {
  return /^(\d)\1{3}$/.test(code) || '0123456789'.includes(code) || '9876543210'.includes(code)
}
