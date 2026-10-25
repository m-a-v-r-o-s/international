import 'server-only'

import type { Staff } from '@/lib/auth/session'
import { gratisUnlocked } from '@/lib/auth/gratis'
import type { supabaseServer } from '@/lib/supabase/server'

/**
 * §48 · The bookings a locked manager browser does not show anywhere: waived
 * and returned. Empty for a rep (they never knew) and for an unlocked browser.
 * Screens drop these ids from what they fetched, the same way they already
 * filter their capped lists in TypeScript.
 */
export async function hiddenWaivedIds(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  staff: Pick<Staff, 'id' | 'role'>,
): Promise<Set<string>> {
  if (staff.role !== 'admin' || (await gratisUnlocked(staff.id))) return new Set()
  const { data } = await supabase.rpc('admin_hidden_waived_ids')
  return new Set(data ?? [])
}
