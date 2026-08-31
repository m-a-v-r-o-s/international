import 'server-only'

import { cookies, headers } from 'next/headers'
import { supabaseAdmin } from '../supabase/admin'
import { supabaseServer } from '../supabase/server'
import { sha256Hex } from '../hash'
import { logSecurityEvent } from '../rate-limit'
import { isProduction } from '../env'
import { serverEnv } from '../env'
import { LOCALE_COOKIE, isLocale } from '@/i18n/locale'
import {
  ADMIN_GATE_TTL_SECONDS, DEVICE_COOKIE, GATE_COOKIE, newDeviceId, signGate, type Gate,
} from './gate'

/** The caller's IP, hashed — for rate limiting and the security log, not for storage. */
export async function requestIpHash(): Promise<string> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  return sha256Hex(forwarded || h.get('x-real-ip') || 'unknown')
}

/**
 * Everything that has to happen once a sign-in has actually succeeded:
 * establish the gate, bind the device for a rep, and carry the person's
 * language preference into the cookie the layout reads.
 */
export async function establishSession(profileId: string): Promise<{
  role: 'admin' | 'rep'
  hasPin: boolean
  active: boolean
}> {
  const admin = supabaseAdmin()
  const { data } = await admin
    .from('profiles')
    .select('role, lang, active, pin_hash')
    .eq('id', profileId)
    .maybeSingle()

  const profile = data as
    | { role: 'admin' | 'rep'; lang: string; active: boolean; pin_hash: string | null }
    | null

  if (!profile || !profile.active) {
    return { role: 'rep', hasPin: false, active: false }
  }

  const store = await cookies()

  if (isLocale(profile.lang)) {
    store.set(LOCALE_COOKIE, profile.lang, {
      httpOnly: false,   // the language is not a secret, and the client toggles it
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
  }

  if (profile.role === 'rep') {
    // One device per rep. Signing in here unbinds wherever they were before,
    // and the next request from that phone is turned away by requireStaff().
    let deviceId = store.get(DEVICE_COOKIE)?.value
    if (!deviceId) {
      deviceId = newDeviceId()
      store.set(DEVICE_COOKIE, deviceId, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365 * 2,
      })
    }

    const h = await headers()
    const { data: replaced } = await admin.rpc('bind_rep_device', {
      p_profile_id: profileId,
      p_device_id: deviceId,
      // `p_user_agent text default null` — optional in the generated Args,
      // and an omitted key takes the same default.
      p_user_agent: h.get('user-agent') ?? undefined,
    })

    if (replaced === true) {
      await logSecurityEvent({
        kind: 'device_rebound',
        profileId,
        ipHash: await requestIpHash(),
      })
    }
  }

  // The admin is never PIN-locked; a rep starts locked and unlocks with a PIN.
  await writeGate({
    sub: profileId,
    role: profile.role,
    unlockedUntil: profile.role === 'admin'
      ? Math.floor(Date.now() / 1000) + ADMIN_GATE_TTL_SECONDS
      : 0,
  })

  return { role: profile.role, hasPin: typeof profile.pin_hash === 'string', active: true }
}

export async function writeGate(gate: Gate): Promise<void> {
  const store = await cookies()
  store.set(GATE_COOKIE, await signGate(gate, serverEnv().sessionSecret), {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export async function clearSession(): Promise<void> {
  const supabase = await supabaseServer()
  await supabase.auth.signOut()
  const store = await cookies()
  store.delete(GATE_COOKIE)
}
