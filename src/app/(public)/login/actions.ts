'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { allow, logSecurityEvent } from '@/lib/rate-limit'
import { sha256Hex } from '@/lib/hash'
import { emailBucket } from '@/lib/auth/gate'
import { clearSession, establishSession, requestIpHash } from '@/lib/auth/signin'

/**
 * Two sign-in paths, because the two roles authenticate differently
 * (docs/01-DECISIONS.md §21). Which one a person uses is their own choice on
 * screen — the server never reveals which one an address belongs to, so the
 * login form cannot be used to test whether an email is on the staff list.
 *
 * Every failure returns the same message key. Every state returned here is a
 * key, not a sentence: the words live in the message catalogues.
 */
export type LoginState = {
  error?: 'failed' | 'rateLimited' | 'inactive' | 'invalidEmail' | 'invalidCode' | 'passwordTooShort'
  codeSent?: boolean
  email?: string
}

const emailSchema = z.string().trim().toLowerCase().email().max(254)
const passwordSchema = z.string().min(1).max(200)
const codeSchema = z.string().trim().regex(/^\d{6}$/)

export async function signInWithPassword(
  _prev: LoginState, formData: FormData,
): Promise<LoginState> {
  const email = emailSchema.safeParse(formData.get('email'))
  const password = passwordSchema.safeParse(formData.get('password'))

  if (!email.success) return { error: 'invalidEmail' }
  if (!password.success) return { error: 'passwordTooShort', email: email.data }

  const ipHash = await requestIpHash()
  const emailHash = await sha256Hex(email.data)

  // Two buckets: one stops a single account being ground down, the other stops
  // one connection working through a list of addresses.
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
    password: password.data,
  })

  if (error || !data.user) {
    await logSecurityEvent({ kind: 'login_failed', emailHash, ipHash })
    return { error: 'failed', email: email.data }
  }

  const session = await establishSession(data.user.id)

  if (!session.active) {
    await clearSession()
    await logSecurityEvent({ kind: 'login_inactive', profileId: data.user.id, ipHash })
    return { error: 'inactive', email: email.data }
  }

  await logSecurityEvent({ kind: 'login_ok', profileId: data.user.id, ipHash })

  // A rep with no PIN yet sets one now; that is the second half of first use.
  redirect(session.role === 'rep' ? '/unlock' : '/')
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
