'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { allow, logSecurityEvent } from '@/lib/rate-limit'
import { sha256Hex } from '@/lib/hash'
import { emailBucket } from '@/lib/auth/gate'
import { isWellFormedPin, verifyPin } from '@/lib/auth/pin'
import {
  clearSession, establishSession, mintSessionForEmail, openUnlockWindow, requestIpHash,
} from '@/lib/auth/signin'

/**
 * Two sign-in paths, because the two roles authenticate differently
 * (docs/01-DECISIONS.md §21, §32). Which one a person uses is their own choice
 * on screen — the server never reveals which one an address belongs to, so the
 * login form cannot be used to test whether an email is on the staff list.
 *
 * Every failure returns the same message key. Every state returned here is a
 * key, not a sentence: the words live in the message catalogues.
 */
export type LoginState = {
  error?:
    | 'failed' | 'rateLimited' | 'inactive' | 'invalidEmail' | 'invalidCode' | 'credentialMissing'
  codeSent?: boolean
  email?: string
}

const emailSchema = z.string().trim().toLowerCase().email().max(254)

/**
 * Deliberately permissive, and it has to be: this one field now carries either
 * a rep's PIN or the long generated password an account minted before §32 was
 * given. Narrowing it to digits would lock out the second kind, and narrowing
 * it at all would tell the browser something the server has not decided yet.
 * What the value IS gets decided below, by trying it.
 */
const credentialSchema = z.string().min(1).max(200)
const codeSchema = z.string().trim().regex(/^\d{6}$/)

/**
 * One field, either credential.
 *
 * A rep types the six-digit PIN the boss handed them (§32) and that is the
 * whole of their credential — there is no password step in front of it and no
 * "now choose a PIN" step behind it. An account that predates that decision
 * still holds a real password, and the boss's own account always did, so the
 * password is tried FIRST and unchanged; the PIN is what a failure falls
 * through to. Both paths end in the same place and answer with the same words.
 */
export async function signInWithCredential(
  _prev: LoginState, formData: FormData,
): Promise<LoginState> {
  const email = emailSchema.safeParse(formData.get('email'))
  const credential = credentialSchema.safeParse(formData.get('credential'))

  if (!email.success) return { error: 'invalidEmail' }
  if (!credential.success) return { error: 'credentialMissing', email: email.data }

  const ipHash = await requestIpHash()
  const emailHash = await sha256Hex(email.data)

  // Two buckets: one stops a single account being ground down, the other stops
  // one connection working through a list of addresses. ONE attempt is counted
  // here, before either credential type is tried, because one attempt is what
  // the person made — which path it turns out to be is the server's business,
  // and a second counter behind the PIN branch would let an attacker learn
  // which addresses take a PIN by watching where the limit bites.
  //
  // Whether 8 per 15 minutes is enough for a six-digit PIN, given the PIN is
  // now reachable from any device with no prior binding: the bucket is per
  // ADDRESS, so it caps one account at ~768 guesses a day against a keyspace of
  // a million — a little over three and a half years to walk half of it, with
  // every failure written to the security log and argon2id at OWASP cost on
  // each one. The IP bucket does not have to carry this, and does not.
  const permitted =
    (await allow(await emailBucket('login', email.data), 8, 900)) &&
    (await allow(`login-ip:${ipHash}`, 40, 900))

  if (!permitted) {
    await logSecurityEvent({ kind: 'login_rate_limited', emailHash, ipHash })
    return { error: 'rateLimited', email: email.data }
  }

  const supabase = await supabaseServer()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.data,
    password: credential.data,
  })

  if (!error && data.user) {
    const session = await establishSession(data.user.id)

    if (!session.active) {
      await clearSession()
      await logSecurityEvent({ kind: 'login_inactive', profileId: data.user.id, ipHash })
      return { error: 'inactive', email: email.data }
    }

    await logSecurityEvent({ kind: 'login_ok', profileId: data.user.id, ipHash })

    // A rep on this path is an account from before §32: it may still have no
    // PIN, and /unlock is where it gets one.
    redirect(session.role === 'rep' ? '/unlock' : '/')
  }

  if (isWellFormedPin(credential.data)) {
    const byPin = await signInWithPin(email.data, credential.data, ipHash)
    if (byPin) return { ...byPin, email: email.data }
  }

  await logSecurityEvent({ kind: 'login_failed', emailHash, ipHash })
  return { error: 'failed', email: email.data }
}

/**
 * The PIN half. Returns a state to show, or null to fall through to the one
 * generic failure the caller ends with — which is what every "this address is
 * not a rep", "there is no such address" and "that PIN is wrong" does, so none
 * of the three can be told apart from outside.
 *
 * The order of the checks is load-bearing. `active` is examined only AFTER the
 * PIN has verified: telling an unauthenticated caller that an account exists
 * but is deactivated would be exactly the enumeration the rest of this file is
 * built to avoid, and the password path only ever reaches its own 'inactive'
 * with a correct password too.
 *
 * The residual, named rather than left implicit: an address that belongs to no
 * rep returns here without paying for an argon2 verification, so a caller who
 * can time the response precisely enough could in principle tell "no such rep"
 * from "wrong PIN" — the words are identical, the clock is not. Equalising it
 * means verifying every miss against a dummy hash, which doubles the cost of
 * exactly the requests an attacker controls. It is left as it is because the
 * rate limiter above caps an address at 8 attempts per 15 minutes either way,
 * and because signInWithPassword() above has the same shape and is GoTrue's to
 * fix. If it is ever closed, close it there too rather than only here.
 */
async function signInWithPin(
  email: string, pin: string, ipHash: string,
): Promise<LoginState | null> {
  // No session exists yet, so nothing about this address is reachable through
  // the anon key. 0029's service-role-only RPC is the whole of the read.
  const { data } = await supabaseAdmin().rpc('credential_lookup_for_email', { p_email: email })
  const account = (data ?? [])[0]

  if (!account || account.role !== 'rep') return null
  if (!(await verifyPin(pin, account.pin_hash))) {
    // Named against the profile rather than left to the caller's generic
    // login_failed: a rep's PIN being guessed at is a different thing for the
    // boss to see in the log than an address that does not exist.
    await logSecurityEvent({ kind: 'pin_failed', profileId: account.id, ipHash })
    return { error: 'failed' }
  }

  if (!account.active) {
    await logSecurityEvent({ kind: 'login_inactive', profileId: account.id, ipHash })
    return { error: 'inactive' }
  }

  // The PIN is right, so a Supabase session is minted for them — see
  // mintSessionForEmail(): the gate cookie alone is not a session, and
  // currentStaff() would find nobody without this.
  const minted = await mintSessionForEmail(email)
  if (!minted) {
    await logSecurityEvent({ kind: 'login_session_failed', profileId: account.id, ipHash })
    return { error: 'failed' }
  }

  const session = await establishSession(minted.userId)

  if (!session.active) {
    await clearSession()
    await logSecurityEvent({ kind: 'login_inactive', profileId: minted.userId, ipHash })
    return { error: 'inactive' }
  }

  await logSecurityEvent({
    kind: 'login_ok', profileId: minted.userId, ipHash, detail: { via: 'pin' },
  })

  // Straight to the app, not to /unlock. The PIN that unlock screen asks for is
  // the one that was just verified a few lines up, and asking for it twice in
  // one sign-in would be ceremony rather than a second factor.
  await openUnlockWindow(minted.userId, session.role)
  redirect('/')
}

export async function requestSignInCode(
  _prev: LoginState, formData: FormData,
): Promise<LoginState> {
  const email = emailSchema.safeParse(formData.get('email'))
  if (!email.success) return { error: 'invalidEmail' }

  const ipHash = await requestIpHash()
  const emailHash = await sha256Hex(email.data)

  const permitted =
    (await allow(await emailBucket('otp', email.data), 5, 900)) &&
    (await allow(`otp-ip:${ipHash}`, 20, 900))

  if (!permitted) {
    await logSecurityEvent({ kind: 'otp_rate_limited', emailHash, ipHash })
    return { error: 'rateLimited', email: email.data }
  }

  // The code path belongs to the manager account. For any other address we do
  // the same amount of nothing and return the same answer.
  const { data: role } = await supabaseAdmin().rpc('role_for_email', { p_email: email.data })

  if (role === 'admin') {
    const supabase = await supabaseServer()
    await supabase.auth.signInWithOtp({
      email: email.data,
      options: { shouldCreateUser: false },
    })
  }

  await logSecurityEvent({ kind: 'otp_requested', emailHash, ipHash })
  return { codeSent: true, email: email.data }
}

export async function verifySignInCode(
  _prev: LoginState, formData: FormData,
): Promise<LoginState> {
  const email = emailSchema.safeParse(formData.get('email'))
  const code = codeSchema.safeParse(formData.get('code'))

  if (!email.success) return { error: 'invalidEmail' }
  if (!code.success) return { error: 'invalidCode', codeSent: true, email: email.data }

  const ipHash = await requestIpHash()
  const emailHash = await sha256Hex(email.data)

  const permitted =
    (await allow(await emailBucket('otp-verify', email.data), 10, 900)) &&
    (await allow(`otp-verify-ip:${ipHash}`, 40, 900))

  if (!permitted) {
    await logSecurityEvent({ kind: 'otp_rate_limited', emailHash, ipHash })
    return { error: 'rateLimited', codeSent: true, email: email.data }
  }

  const supabase = await supabaseServer()
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.data,
    token: code.data,
    type: 'email',
  })

  if (error || !data.user) {
    await logSecurityEvent({ kind: 'otp_failed', emailHash, ipHash })
    return { error: 'failed', codeSent: true, email: email.data }
  }

  const session = await establishSession(data.user.id)

  // A code is only ever sent to the manager, but verify the role rather than
  // trusting that: the session that comes back is what decides.
  if (!session.active || session.role !== 'admin') {
    await clearSession()
    await logSecurityEvent({ kind: 'otp_wrong_role', profileId: data.user.id, ipHash })
    return { error: session.active ? 'failed' : 'inactive', codeSent: true, email: email.data }
  }

  await logSecurityEvent({ kind: 'login_ok', profileId: data.user.id, ipHash })
  redirect('/')
}
