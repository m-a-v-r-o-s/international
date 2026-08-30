import 'server-only'

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
}

/**
 * The authoritative answer to "who is this, and may they be here".
 *
 * Every server action and every protected page calls one of these. The gate
 * cookie the edge reads is a fast rejection, not a permission: a request that
 * gets past middleware still lands here, and then still lands on RLS.
 */
export async function currentStaff(): Promise<Staff | null> {
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

  // `pin_hash` is granted to no client role, so whether a PIN exists is asked
  // of the service role rather than selected alongside the profile.
  const { data: pin } = await supabaseAdmin()
    .from('profiles').select('pin_hash').eq('id', user.id).maybeSingle()

  return {
    id: data.id as string,
    role: data.role as 'admin' | 'rep',
    fullName: (data.full_name as string) || '',
    lang: (data.lang as 'el' | 'en') ?? 'el',
    hasPin: typeof (pin as { pin_hash?: string | null } | null)?.pin_hash === 'string',
  }
}

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

/** A rep who has not entered their PIN gets no further than the unlock screen. */
export async function requireUnlocked(): Promise<Staff> {
  const staff = await requireStaff()
  if (staff.role === 'rep') {
    const { isUnlocked, readGate, GATE_COOKIE } = await import('./gate')
    const { serverEnv } = await import('../env')
    const store = await cookies()
    const gate = await readGate(store.get(GATE_COOKIE)?.value, serverEnv().sessionSecret)
    if (gate?.sub !== staff.id || !isUnlocked(gate)) redirect('/unlock')
  }
  return staff
}

async function deviceMatches(profileId: string): Promise<boolean> {
  const store = await cookies()
  const deviceId = store.get(DEVICE_COOKIE)?.value
  if (!deviceId) return false

  const { data, error } = await supabaseAdmin().rpc('rep_device_matches', {
    p_profile_id: profileId,
    p_device_id: deviceId,
  })
  if (error) return false
  return data === true
}
