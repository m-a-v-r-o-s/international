import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../supabase/database.types'
import { supabaseAdmin } from '../supabase/admin'
import { allow, logSecurityEvent } from '../rate-limit'
import type { ErrorKey } from '../errors'
import { BOOKING_FILES_BUCKET, parseBookingFilePath } from '../storage/paths'
import { canReadBooking, uploadBookingFile } from '../storage/booking-files'
import { sniffType, IMAGE_TYPES } from '../storage/sniff'

/**
 * Reusing a returning guest's licence photographs on a new booking.
 *
 * THE OBJECT IS COPIED, NEVER SHARED. The alternative — pointing the new
 * booking's driver row at the old booking's object, or minting a signed URL
 * against the old path — was rejected, and the reason is retention. Every
 * licence image in this system is deleted when ITS BOOKING's rental has been
 * over for the admin's window (docs/01-DECISIONS.md §25), and the sweep decides
 * that from the object's own path: `<booking>/licences/<file>`. A shared object
 * would sit under the FIRST booking's id, so it would be swept on the first
 * rental's clock while the second rental was still current — or, if the sweep
 * were taught to spare it, would outlive the window on a technicality. Copying
 * gives the new rental its own file under its own booking, with its own clock,
 * and leaves the original exactly as it was. Nothing here widens read access to
 * the old path by so much as one request.
 *
 * THE ONE PRIVILEGE ESCALATION, STATED PLAINLY. The download on line ~90 runs
 * as the SERVICE ROLE, which bypasses RLS. It has to: the whole premise of the
 * company-wide lookup (§25a) is that the rep in front of the guest may not be
 * the rep who served them last year, so by construction they cannot read the
 * source booking. That is the widening the owner chose, and this is where it is
 * cashed. It is fenced accordingly:
 *
 *   · the rep must be able to write the TARGET booking — checked against the
 *     policy through their own session, before anything is read;
 *   · the source path comes from public.customer_licence_images(), which will
 *     only ever name the object a CONSENTING customer's own ledger row points
 *     at — never an arbitrary path from the client;
 *   · the path is re-parsed here and refused unless it is a `licences` object,
 *     so no route through this function can reach a contract or a signature;
 *   · the bytes are sniffed again before they are re-uploaded;
 *   · it is rate limited, and every copy writes a security event naming both
 *     bookings.
 */
export type ReuseOutcome =
  | { ok: true; sides: ('front' | 'back')[] }
  | { ok: false; reason: ErrorKey | 'noImages' }

type Client = SupabaseClient<Database>

export async function reuseLicenceImages(
  supabase: Client,
  input: {
    customerId: string
    bookingId: string
    driverId: string
    actorId: string
  },
): Promise<ReuseOutcome> {
  // The target first, through the caller's own session. A rep who may not
  // write this booking gets no further, and in particular never causes a
  // service-role read of anything.
  if (!(await canReadBooking(supabase, input.bookingId))) return { ok: false, reason: 'forbidden' }

  if (!(await allow(`licencereuse:${input.actorId}`, 40, 3600))) {
    return { ok: false, reason: 'rateLimited' }
  }

  const { data, error } = await supabase.rpc('customer_licence_images', {
    p_customer_id: input.customerId,
  })
  if (error) return { ok: false, reason: 'forbidden' }

  const source = data?.[0]
  if (!source?.front_path) return { ok: false, reason: 'noImages' }

  // Copying an object onto the booking it already belongs to would overwrite a
  // fresher scan with an older one. Nothing to do, and not an error.
  if (source.source_booking_id === input.bookingId) return { ok: false, reason: 'noImages' }

  const admin = supabaseAdmin()
  const copied: ('front' | 'back')[] = []
  const paths: { front_image_path?: string; back_image_path?: string } = {}

  for (const [side, sourcePath] of [
    ['front', source.front_path], ['back', source.back_path],
  ] as const) {
    if (!sourcePath) continue

    // The second of the two layers, the same arrangement the retention purge
    // uses: the database said this is a licence object, and this says so
    // independently, from the path itself, with no shared code.
    const parsed = parseBookingFilePath(sourcePath)
    if (!parsed || parsed.kind !== 'licences') continue
    if (parsed.bookingId !== source.source_booking_id) continue
    if (parsed.bookingId === input.bookingId) continue

    const { data: blob, error: downloadError } = await admin.storage
      .from(BOOKING_FILES_BUCKET).download(sourcePath)
    // A missing object is the retention purge having got there first, or the
    // guest having been erased between the lookup and the tap. Neither is an
    // error worth failing a pickup over — the rep photographs the licence.
    if (downloadError || !blob) continue

    const bytes = new Uint8Array(await blob.arrayBuffer())
    const type = sniffType(bytes)
    if (!type || !IMAGE_TYPES.includes(type)) continue

    // Uploaded through the CALLER's session, so the target booking's own
    // policies decide whether this file may exist, exactly as they do for a
    // photo taken on the spot.
    const uploaded = await uploadBookingFile(supabase, {
      bookingId: input.bookingId,
      kind: 'licences',
      basename: `${input.driverId}-${side}`,
      bytes,
      contentType: type,
    })
    if (!uploaded.ok) return { ok: false, reason: uploaded.reason }

    paths[side === 'front' ? 'front_image_path' : 'back_image_path'] = uploaded.path
    copied.push(side)
  }

  if (copied.length === 0) return { ok: false, reason: 'noImages' }

  const { error: writeError } = await supabase.from('booking_drivers')
    .update(paths).eq('id', input.driverId).eq('booking_id', input.bookingId)
  if (writeError) return { ok: false, reason: 'unknown' }

  // Both bookings, because the point of this line is to be able to answer
  // "who moved this guest's licence photograph, and from where". Never a
  // licence number, never a path (docs/03-SECURITY.md, "Logging").
  await logSecurityEvent({
    kind: 'licence_image_reused',
    profileId: input.actorId,
    detail: {
      source_booking_id: source.source_booking_id,
      target_booking_id: input.bookingId,
      sides: copied.length,
    },
  })

  return { ok: true, sides: copied }
}
