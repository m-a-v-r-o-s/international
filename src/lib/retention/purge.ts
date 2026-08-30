import 'server-only'

import { supabaseAdmin } from '../supabase/admin'
import { logSecurityEvent } from '../rate-limit'
import { BOOKING_FILES_BUCKET, parseBookingFilePath } from '../storage/paths'

/**
 * The licence-image retention purge (docs/01-DECISIONS.md §25).
 *
 * It runs as the service role, which bypasses RLS entirely, so the predicate
 * in supabase/migrations/20260830160000_retention.sql is the only thing
 * standing between a correct sweep and deleting a contract. Everything here is
 * arranged around that one fact.
 *
 * WHY THE DELETION IS HERE AND NOT IN SQL. The sweep was written down in
 * docs/06-IMPLEMENTATION-NOTES.md as `delete from storage.objects where ...`,
 * and that is the right PREDICATE but the wrong VERB. On Supabase,
 * `storage.objects` is the metadata table in front of the bucket's backing
 * store: deleting a row there removes the app's knowledge of the file and
 * leaves the file itself behind. A purge that records deleting a scanned
 * driving licence while the object is still sitting in the bucket is worse
 * than no purge at all — it is a GDPR obligation marked done. So the database
 * hands over the list and the Storage API, which owns both halves, does the
 * deleting.
 *
 * TWO INDEPENDENT LAYERS DECIDE WHAT MAY BE DELETED. The SQL only ever
 * returns objects whose second path segment is `licences`, read through the
 * same app.object_file_kind() the bucket policies use. Then every path that
 * comes back is re-parsed here, and anything that is not
 * <booking>/licences/<file> — or that names a different booking from the one
 * the query reported — is dropped rather than deleted. The two layers share
 * no code. A contract or a signature has to get past both to be touched, and
 * neither will pass it.
 */
export type PurgeOutcome = {
  /** Objects the Storage API confirmed gone. */
  deleted: number
  /** Bookings whose drivers were stamped `images_purged_at`. */
  bookings: number
  driversMarked: number
  /** Returned by the query but refused by the second check. Should always be 0. */
  refused: number
  /** Batches the Storage API rejected; nothing is marked purged for these. */
  failed: number
  dryRun: boolean
}

const DEFAULT_BATCH = 200
const MAX_BATCHES = 50

export async function purgeLicenceImages(options: {
  batchSize?: number
  /** Reports what would go without removing anything. A10's preview uses it. */
  dryRun?: boolean
  actorId?: string
} = {}): Promise<PurgeOutcome> {
  const batchSize = Math.min(Math.max(options.batchSize ?? DEFAULT_BATCH, 1), 500)
  const dryRun = options.dryRun === true
  const admin = supabaseAdmin()

  const outcome: PurgeOutcome = {
    deleted: 0, bookings: 0, driversMarked: 0, refused: 0, failed: 0, dryRun,
  }
  const bookingsTouched = new Set<string>()

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data, error } = await admin.rpc('licence_images_due_for_purge', {
      p_limit: batchSize,
    })
    if (error) {
      outcome.failed++
      break
    }

    const rows = (data ?? []) as { object_name: string; booking_id: string }[]
    if (rows.length === 0) break

    // The second of the two layers. A path that does not parse, is not a
    // licence, or names a booking other than the one the query reported is
    // dropped — never deleted, and never marked as purged either.
    const safe = rows.filter((row) => {
      const parsed = parseBookingFilePath(row.object_name)
      const ok = parsed !== null
        && parsed.kind === 'licences'
        && parsed.bookingId === row.booking_id
      if (!ok) outcome.refused++
      return ok
    })

    if (safe.length === 0) break

    if (dryRun) {
      outcome.deleted += safe.length
      for (const row of safe) bookingsTouched.add(row.booking_id)
      // A dry run must not loop: nothing was removed, so the same rows would
      // come back for ever.
      break
    }

    const { error: removeError } = await admin.storage
      .from(BOOKING_FILES_BUCKET)
      .remove(safe.map((row) => row.object_name))

    if (removeError) {
      // Leave the rows alone. They are still due, and the next run will find
      // them again — which is the right failure for a job that must never
      // record a deletion that did not happen.
      outcome.failed++
      break
    }

    outcome.deleted += safe.length

    const ids = [...new Set(safe.map((row) => row.booking_id))]
    for (const id of ids) bookingsTouched.add(id)

    const { data: marked } = await admin.rpc('mark_licences_purged', { p_booking_ids: ids })
    outcome.driversMarked += typeof marked === 'number' ? marked : 0

    if (rows.length < batchSize) break
  }

  outcome.bookings = bookingsTouched.size

  // "Every purge is logged" (§25), and docs/03-SECURITY.md lists retention
  // purges among the security events. Counts and nothing else: no path, no
  // booking reference, no licence number.
  if (!dryRun && (outcome.deleted > 0 || outcome.refused > 0 || outcome.failed > 0)) {
    await logSecurityEvent({
      kind: 'licence_purge',
      profileId: options.actorId ?? null,
      detail: {
        objects: outcome.deleted,
        bookings: outcome.bookings,
        drivers: outcome.driversMarked,
        refused: outcome.refused,
        failed: outcome.failed,
      },
    })
  }

  return outcome
}
