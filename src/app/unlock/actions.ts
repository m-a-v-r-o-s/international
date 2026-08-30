'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { allow, logSecurityEvent } from '@/lib/rate-limit'
import { hashPin, isWellFormedPin, verifyPin, PIN_MAX, PIN_MIN } from '@/lib/auth/pin'
import { requireStaff } from '@/lib/auth/session'
import { requestIpHash, writeGate } from '@/lib/auth/signin'
import { UNLOCK_TTL_SECONDS } from '@/lib/auth/gate'

export type UnlockState = {
  error?: 'wrong' | 'rateLimited' | 'tooShort' | 'mismatch' | 'digitsOnly' | 'unknown'
}

const pinSchema = z.string().trim().max(32)

/** First use: the rep chooses the PIN they will reopen the app with. */
export async function setPin(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const staff = await requireStaff()

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
  await unlockFor(staff.id, staff.role)
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

  await unlockFor(staff.id, staff.role)
  redirect('/')
}

async function unlockFor(id: string, role: 'admin' | 'rep'): Promise<void> {
  await writeGate({
    sub: id,
    role,
    unlockedUntil: Math.floor(Date.now() / 1000) + UNLOCK_TTL_SECONDS,
  })
}
