import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../supabase/database.types'
import { supabaseAdmin } from '../supabase/admin'
import { logSecurityEvent } from '../rate-limit'
import { errorKey, type ErrorKey } from '../errors'
import { BOOKING_FILES_BUCKET, parseBookingFilePath } from '../storage/paths'

/**
 * The right-to-erasure path for one guest (docs/01-DECISIONS.md §25a).
 *
 * The ledger has NO automatic expiry — that was the owner's decision and it is
 * argued out in §25a — which puts the whole weight of "we do not keep this
 * longer than we should" on two things actually working: this, and the boss's
 * clear-everything button. So this is written like the retention purge next
 * door rather than like a delete button.
 *
 * WHAT IT ERASES, PRECISELY. The customer row, its consent links, and the
 * guest's licence PHOTOGRAPHS. What it does NOT erase is the bookings
 * themselves: a completed rental is an accounting and insurance record, it is
 * held under a different obligation from the ledger, and §25 already says the
 * booking record and the typed licence number are retained. So what a guest
 * gets when they ask to be forgotten is that they stop being a person this
 * system recognises across bookings, and their licence photographs go early
 * rather than waiting out the §25 window. That is the honest description and
 * it is the one the privacy policy gives.
 *
 * THE OBJECTS GO THROUGH THE STORAGE API, for the same reason the §25 purge
 * does: `delete from storage.objects` removes the metadata row and leaves the
 * file in the bucket, which would be an erasure request marked done with the
 * photograph still there.
 */
export type EraseOutcome =
  | { ok: true; imagesDeleted: number }
  | { ok: false; reason: ErrorKey }

type Client = SupabaseClient<Database>

export async function eraseCustomer(
  supabase: Client, customerId: string, actorId: string,
): Promise<EraseOutcome> {
  // Admin-only, asserted in the function itself (app.assert_admin), so this
  // cannot be reached by a rep whatever the screen in front of them says.
  const { data, error } = await supabase.rpc('admin_erase_customer', {
    p_customer_id: customerId,
  })
  if (error) return { ok: false, reason: errorKey(error) }

  const row = data?.[0]
  const doomed = [row?.front_path, row?.back_path]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    // Re-parsed rather than trusted, the same second layer the purge applies:
    // only a `licences` object can be deleted here, so a corrupted pointer
    // cannot turn an erasure request into a deleted contract.
    .filter((p) => parseBookingFilePath(p)?.kind === 'licences')

  let imagesDeleted = 0
  if (doomed.length > 0) {
    const { error: removeError } = await supabaseAdmin().storage
      .from(BOOKING_FILES_BUCKET).remove(doomed)
    // The row is already gone; report the shortfall rather than claiming a
    // deletion that did not happen. The §25 sweep will still take these
    // objects on the booking's own clock.
    if (!removeError) imagesDeleted = doomed.length
    else {
      await logSecurityEvent({
        kind: 'customer_erase_images_failed',
        profileId: actorId,
        detail: { objects: doomed.length },
      })
    }
  }

  return { ok: true, imagesDeleted }
}
