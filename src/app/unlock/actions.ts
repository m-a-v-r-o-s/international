'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { allow, logSecurityEvent } from '@/lib/rate-limit'
import { hashPin, isChosenPinLength, isPredictablePin, verifyPin } from '@/lib/auth/pin'
import { requireStaff } from '@/lib/auth/session'
import { openUnlockWindow, requestIpHash } from '@/lib/auth/signin'

export type UnlockState = {
  error?: 'wrong' | 'rateLimited' | 'length' | 'weak' | 'mismatch' | 'digitsOnly' | 'unknown'
}

const pinSchema = z.string().trim().max(32)

/**
 * The fallback, not a step: since §32 the boss issues the PIN when he creates
 * the account, so a rep reaches this only if their `pin_hash` is somehow null.
 *
 * THE `hasPin` GUARD IS LOAD-BEARING AND IS NOT THE LEFTOVER IT LOOKS LIKE.
 * Since §38 a rep CAN change their own PIN, so this is no longer the only
 * self-service door and no longer needs to refuse on those grounds. It refuses
 * for a sharper reason: this action is the one place a PIN is written WITHOUT
 * the old one being proved, because a row with a null hash has no old one to
 * prove. Let it run against a row that does have a PIN and it becomes a way to
 * take an account over an unattended, unlocked phone without knowing anything —
 * exactly what changePin()'s current-PIN field exists to prevent. That is why
 * the check is here, in the action, and not only in the page that decides
 * whether to render SetPinForm.
 *
 * A PIN chosen here is the rep's own, so it clears pin_must_change and follows
 * the same rules as one chosen on /change-pin: six digits, nothing predictable.
 */
export async function setPin(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const staff = await requireStaff()
  if (staff.hasPin) return { error: 'unknown' }

  const pin = pinSchema.safeParse(formData.get('pin'))
  const confirm = pinSchema.safeParse(formData.get('confirm'))
  if (!pin.success || !confirm.success) return { error: 'unknown' }

  if (!/^\d*$/.test(pin.data)) return { error: 'digitsOnly' }
  if (!isChosenPinLength(pin.data)) return { error: 'length' }
  if (isPredictablePin(pin.data)) return { error: 'weak' }
  if (pin.data !== confirm.data) return { error: 'mismatch' }

  const { error } = await supabaseAdmin().rpc('set_pin_hash', {
    p_profile_id: staff.id,
    p_hash: await hashPin(pin.data),
    p_boss_issued: false,
  })
  if (error) return { error: 'unknown' }

  await logSecurityEvent({ kind: 'pin_set', profileId: staff.id, ipHash: await requestIpHash() })
  await openUnlockWindow(staff.id, staff.role)
  redirect('/')
}

export async function unlock(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const staff = await requireStaff()
  const pin = pinSchema.safeParse(formData.get('pin'))
  if (!pin.success) return { error: 'wrong' }

  const ipHash = await requestIpHash()

  // A four-digit PIN has ten thousand possibilities, so this limit is doing
  // real work — argon2 alone would not be enough.
  if (!(await allow(`unlock:${staff.id}`, 6, 300))) {
    await logSecurityEvent({ kind: 'pin_rate_limited', profileId: staff.id, ipHash })
    return { error: 'rateLimited' }
  }

  const { data } = await supabaseAdmin()
    .from('profiles').select('pin_hash').eq('id', staff.id).maybeSingle()

  const stored = (data as { pin_hash: string | null } | null)?.pin_hash ?? null

  if (!(await verifyPin(pin.data, stored))) {
    await logSecurityEvent({ kind: 'pin_failed', profileId: staff.id, ipHash })
    return { error: 'wrong' }
  }

  await openUnlockWindow(staff.id, staff.role)
  redirect('/')
}
