import 'server-only'

import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabaseServer } from '../supabase/server'
import { supabaseAdmin } from '../supabase/admin'
import { DEVICE_COOKIE } from './gate'

export type Staff = {
  id: string
  role: 'admin' | 'rep'
  fullName: string
  lang: 'el' | 'en'
  hasPin: boolean
  /**
   * The PIN this rep is holding came from the boss, and they have not replaced
   * it yet (docs/01-DECISIONS.md §38). Always false for the admin, who has no
   * PIN at all (§21).
   */
  mustChangePin: boolean
}

/**
 * The authoritative answer to "who is this, and may they be here".
 *
 * Every server action and every protected page calls one of these. The gate
 * cookie the edge reads is a fast rejection, not a permission: a request that
 * gets past middleware still lands here, and then still lands on RLS.
 *
 * Wrapped in React's `cache()`, which de-duplicates it for the length of ONE
 * request. Every screen asks twice — `(app)/layout.tsx` guards the shell and
 * the page inside it guards itself — and each ask was three sequential round
 * trips to Supabase (the auth server, then the profile, then the PIN columns).
 * Six where three would do, on every navigation. Neither call site should have
 * to know the other exists, so the de-duplication belongs here rather than in
 * a rule about who may ask.
 *
 * Scope is the request, not the process: a Server Action that writes a profile
 * and the re-render that follows it are separate requests and each reads
 * fresh. Nothing here re-reads its own write within a single request — and
 * anything that starts to must reach past this, not around it.
 */
export const currentStaff = cache(async function currentStaff(): Promise<Staff | null> {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Through the user's own session, so this read is itself policy-checked.
  const { data } = await supabase
    .from('profiles')
    .select('id, role, full_name, lang, active')
    .eq('id', user.id)
    .maybeSingle()

  if (!data || data.active !== true) return null

  // Neither `pin_hash` nor `pin_must_change` is granted to a client role, so
  // both are asked of the service role rather than selected alongside the
  // profile — one query for the two facts, which are about the same PIN.
  const { data: pin } = await supabaseAdmin()
    .from('profiles').select('pin_hash, pin_must_change').eq('id', user.id).maybeSingle()

  const credential = pin as { pin_hash?: string | null; pin_must_change?: boolean } | null

  return {
    id: data.id as string,
    role: data.role as 'admin' | 'rep',
    fullName: (data.full_name as string) || '',
    lang: (data.lang as 'el' | 'en') ?? 'el',
    hasPin: typeof credential?.pin_hash === 'string',
    mustChangePin: credential?.pin_must_change === true,
  }
})

/** Signed in, active, and — for a rep — still on the device they were bound to. */
export async function requireStaff(): Promise<Staff> {
  const staff = await currentStaff()
  if (!staff) redirect('/login')

  if (staff.role === 'rep' && !(await deviceMatches(staff.id))) {
    redirect('/signed-out?reason=device')
  }
  return staff
}

export async function requireAdmin(): Promise<Staff> {
  const staff = await requireStaff()
  if (staff.role !== 'admin') redirect('/')
  return staff
}

/**
 * A rep who has not entered their PIN gets no further than the unlock screen,
 * and a rep still holding the PIN the boss generated for them gets no further
 * than the screen that asks them to replace it (docs/01-DECISIONS.md §38).
 *
 * The two checks are in this order because the second screen asks for the
 * current PIN: a device that is not unlocked has not proved anyone is holding
 * it, and /change-pin is not the place to find that out.
 *
 * Every screen behind (app)/layout.tsx passes through here, which is what makes
 * the prompt unavoidable rather than a suggestion. It is a redirect, not a
 * permission — a rep who dodged it would be no more privileged than one who did
 * not, only still carrying a credential the boss also knows, which is the state
 * this whole path exists to end.
 */
export async function requireUnlocked(): Promise<Staff> {
  const staff = await requireStaff()
  if (staff.role === 'rep') {
    const { isUnlocked, readGate, GATE_COOKIE } = await import('./gate')
    const { serverEnv } = await import('../env')
    const store = await cookies()
    const gate = await readGate(store.get(GATE_COOKIE)?.value, serverEnv().sessionSecret)
    if (gate?.sub !== staff.id || !isUnlocked(gate)) redirect('/unlock')
    if (staff.mustChangePin) redirect('/change-pin')
  }
  return staff
}

/**
 * Cached per request for the same reason as currentStaff(): a rep's layout and
 * their page each call requireStaff(), and this is the extra round trip that
 * only a rep pays. The device binding cannot change midway through serving one
 * request — the row it reads is written by a different request entirely.
 */
const deviceMatches = cache(async function deviceMatches(profileId: string): Promise<boolean> {
  const store = await cookies()
  const deviceId = store.get(DEVICE_COOKIE)?.value
  if (!deviceId) return false

  const { data, error } = await supabaseAdmin().rpc('rep_device_matches', {
    p_profile_id: profileId,
    p_device_id: deviceId,
  })
  if (error) return false
  return data === true
})
