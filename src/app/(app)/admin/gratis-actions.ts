'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { hashPin, verifyPin } from '@/lib/auth/pin'
import { requestIpHash } from '@/lib/auth/signin'
import { closeGratis, gratisUnlocked, isObviousCode, openGratis } from '@/lib/auth/gratis'
import { allow, logSecurityEvent } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/supabase/admin'

export type GratisState = {
  error?: 'wrong' | 'rateLimited' | 'mismatch' | 'obvious'
  /** No code exists yet: the next submit chooses one, typed twice. */
  setup?: boolean
  done?: boolean
} | undefined

const codeSchema = z.string().regex(/^\d{4}$/)

async function storedHash(): Promise<string | null> {
  const { data } = await supabaseAdmin().from('gratis_lock').select('code_hash').eq('id', 1).maybeSingle()
  return data?.code_hash ?? null
}

/** Checks a new code typed twice; null when it may be saved. */
function newCodeProblem(code: string, confirm: FormDataEntryValue | null): GratisState {
  if (confirm !== code) return { setup: true, error: 'mismatch' }
  if (isObviousCode(code)) return { setup: true, error: 'obvious' }
  return undefined
}

/**
 * §48 · Unlock gratis on this browser for 30 minutes. Ten thousand codes, so
 * the rate limit is what actually protects it, the same as a rep's PIN.
 * The very first use chooses the code.
 */
export async function unlockGratis(_prev: GratisState, formData: FormData): Promise<GratisState> {
  const admin = await requireAdmin()
  const code = codeSchema.safeParse(formData.get('code'))
  if (!code.success) return { error: 'wrong', setup: _prev?.setup }

  const ipHash = await requestIpHash()
  if (!(await allow(`gratis:${admin.id}`, 6, 300))) {
    await logSecurityEvent({ kind: 'gratis_rate_limited', profileId: admin.id, ipHash })
    return { error: 'rateLimited', setup: _prev?.setup }
  }

  const stored = await storedHash()
  if (!stored) {
    if (formData.get('confirm') === null) return { setup: true }
    const problem = newCodeProblem(code.data, formData.get('confirm'))
    if (problem) return problem
    const { error } = await supabaseAdmin().from('gratis_lock').insert({ id: 1, code_hash: await hashPin(code.data) })
    if (error) return { error: 'wrong' }
  } else if (!(await verifyPin(code.data, stored))) {
    await logSecurityEvent({ kind: 'gratis_failed', profileId: admin.id, ipHash })
    return { error: 'wrong' }
  }

  await openGratis(admin.id)
  revalidatePath('/', 'layout')
  return { done: true }
}

export async function lockGratis(): Promise<void> {
  await requireAdmin()
  await closeGratis()
  revalidatePath('/', 'layout')
}

/** §48 · A new code, only from an unlocked browser. */
export async function changeGratisCode(_prev: GratisState, formData: FormData): Promise<GratisState> {
  const admin = await requireAdmin()
  if (!(await gratisUnlocked(admin.id))) return { error: 'wrong' }

  const code = codeSchema.safeParse(formData.get('code'))
  if (!code.success) return { setup: true, error: 'mismatch' }
  const problem = newCodeProblem(code.data, formData.get('confirm'))
  if (problem) return problem

  const { error } = await supabaseAdmin().from('gratis_lock')
    .upsert({ id: 1, code_hash: await hashPin(code.data), updated_at: new Date().toISOString() })
  if (error) return { error: 'wrong' }
  return { done: true }
}
