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
  ADMIN_GATE_TTL_SECONDS, DEVICE_COOKIE, GATE_COOKIE, UNLOCK_TTL_SECONDS, newDeviceId, signGate,
  type Gate,
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

/**
 * Opens the shift-length unlock window on the gate cookie.
 *
 * It lives here rather than in src/app/unlock/actions.ts, where it was a
 * private helper, because two callers now need it: the unlock screen after a
 * PIN is typed, and the login screen after a PIN is typed there instead
 * (docs/01-DECISIONS.md §32). It could NOT simply be exported from that file —
 * every export of a 'use server' module is a callable endpoint, and an endpoint
 * taking an id and a role as arguments is an endpoint that unlocks anybody.
 */
export async function openUnlockWindow(id: string, role: 'admin' | 'rep'): Promise<void> {
  await writeGate({
    sub: id,
    role,
    unlockedUntil: Math.floor(Date.now() / 1000) + UNLOCK_TTL_SECONDS,
  })
}

/**
 * A real Supabase Auth session for somebody the SERVER has already
 * authenticated — the rep whose PIN was just verified against the argon2 hash.
 *
 * WHY THIS IS NEEDED AT ALL, because it is the least obvious part of §32. The
 * gate cookie is not a session and never was (src/lib/auth/gate.ts says so
 * itself): currentStaff() calls supabase.auth.getUser() through the caller's
 * OWN cookies and then queries `profiles` through that same session, so RLS can
 * see who is asking. On the password path it is signInWithPassword() — running
 * on the request-scoped client — that sets those cookies as a side effect. The
 * PIN path calls no supabase.auth.* sign-in method whatsoever, so without this
 * a rep would leave the login screen holding a valid gate cookie, a bound
 * device, and no session: getUser() returns null, requireStaff() redirects
 * straight back to /login, and the loop never breaks.
 *
 * So the credential is minted rather than presented. generateLink() is the
 * GoTrue Admin API's "make me a verification token for this user without
 * sending any email" — which is also the only shape that works here, since
 * email delivery does not exist on this project at all (client item 8). The
 * hashed_token it returns is then redeemed on the request-scoped client, and
 * THAT call writes the session cookies exactly as any other sign-in would.
 *
 * Two things keep this from being a way in:
 *
 *   · It is unreachable without the service-role key, and it is called from
 *     exactly one place — after verifyPin() has returned true against a hash
 *     only the service role can read.
 *   · The token is redeemed in the same request it was issued in, so it never
 *     travels, is never displayed, and is spent before it could be replayed.
 *
 * `type: 'magiclink'` on both halves is not interchangeable with the OTP path's
 * `type: 'email'` — it has to be the verification type the link was generated
 * as, and generateLink({ type: 'magiclink' }) issues a magiclink token.
 */
export async function mintSessionForEmail(
  email: string,
): Promise<{ userId: string } | null> {
  const { data: link, error: linkError } = await supabaseAdmin().auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  const hashedToken = link?.properties?.hashed_token
  if (linkError || !hashedToken) return null

  const supabase = await supabaseServer()
  const { data, error } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: hashedToken,
  })

  if (error || !data.user) return null
  return { userId: data.user.id }
}

export async function writeGate(gate: Gate): Promise<void> {
  const store = await cookies()
  store.set(GATE_COOKIE, await signGate(gate, serverEnv().sessionSecret), {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    // A rep's cookie only ever carries a locked (unlockedUntil: 0) or
    // shift-length unlock, so 30 days is plenty of shell to hold that in.
    // An admin's unlockedUntil is the real, long-lived grant, so the cookie
    // itself has to live at least as long or it disappears out from under it.
    maxAge: gate.role === 'admin' ? ADMIN_GATE_TTL_SECONDS : 60 * 60 * 24 * 30,
  })
}

export async function clearSession(): Promise<void> {
  const supabase = await supabaseServer()
  await supabase.auth.signOut()
  const store = await cookies()
  store.delete(GATE_COOKIE)
}
