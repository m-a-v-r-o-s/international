'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { allow, logSecurityEvent } from '@/lib/rate-limit'
import { hashPin, isWellFormedPin, verifyPin, PIN_MAX, PIN_MIN } from '@/lib/auth/pin'
import { requireStaff } from '@/lib/auth/session'
import { openUnlockWindow, requestIpHash } from '@/lib/auth/signin'

export type UnlockState = {
  error?: 'wrong' | 'rateLimited' | 'tooShort' | 'mismatch' | 'digitsOnly' | 'unknown'
}

const pinSchema = z.string().trim().max(32)

/**
 * The fallback, not a step: since §32 the boss issues the PIN when he creates
 * the account, so a rep reaches this only if their `pin_hash` is somehow null.
 *
 * Refuses once a PIN already exists — only the boss reissues one after that
 * (docs/01-DECISIONS.md §32) — so this cannot become a rep's own self-service
 * "change PIN" if called directly instead of through the UI, which never
 * renders SetPinForm once staff.hasPin is true.
 */
export async function setPin(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const staff = await requireStaff()
  if (staff.hasPin) return { error: 'unknown' }

  const pin = pinSchema.safeParse(formData.get('pin'))
  const confirm = pinSchema.safeParse(formData.get('confirm'))
  if (!pin.success || !confirm.success) return { error: 'unknown' }

  if (!/^\d*$/.test(pin.data)) return { error: 'digitsOnly' }
  if (!isWellFormedPin(pin.data)) return { error: 'tooShort' }
  if (pin.data !== confirm.data) return { error: 'mismatch' }

  const { error } = await supabaseAdmin().rpc('set_pin_hash', {
    p_profile_id: staff.id,
    p_hash: await hashPin(pin.data),
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
