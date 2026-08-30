import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../supabase/database.types'
import { allow, logSecurityEvent } from '../rate-limit'
import type { ErrorKey } from '../errors'
import {
  BOOKING_FILES_BUCKET, bookingFilePath, parseBookingFilePath, type FileKind,
} from './paths'
import { extensionFor, sniffType, IMAGE_TYPES, type SniffedType } from './sniff'

/**
 * Every read and write of the private bucket goes through here.
 *
 * Two rules from docs/03-SECURITY.md shape the whole module:
 *
 *   8. "Licence images: private bucket, signed URLs, short TTL, issued only
 *      after re-checking the caller may see that booking. Never a public URL,
 *      never a permanent one."
 *      Logging: "signed-URL issuance for licence images" is a security event.
 *
 *   Input: "Upload endpoints: whitelist image MIME types by SNIFFING content,
 *      cap size, store in a bucket with its own policy."
 *
 * Both halves are belt and braces on purpose. The bucket's own RLS policies
 * are the authority — `supabase` here is always the CALLER'S session client,
 * never the service role, so an upload or a signed URL is refused by Postgres
 * before this code's own check would matter. The re-check exists so that a
 * mistake in one layer is not the whole of the defence, and so the issuance
 * has something to log.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** Long enough for a phone on hotel wifi to fetch the image; short enough that
 *  a URL copied out of dev tools is stale before it can be passed on. */
const DEFAULT_TTL_SECONDS = 120

/** Deliberately a subset of ErrorKey, so a refusal renders without translation
 *  of its own — every one of these already has a message in both catalogues. */
export type UploadFailure = Extract<ErrorKey, 'forbidden' | 'fileType' | 'fileTooLarge' | 'unknown'>

export type UploadOutcome =
  | { ok: true; path: string; type: SniffedType }
  | { ok: false; reason: UploadFailure }

type Client = SupabaseClient<Database>

/**
 * Does this caller's session let them read this booking?
 *
 * Asked of the database through the caller's own client, so the answer is the
 * `bookings_select` policy's answer — app.can_read_booking() by another route,
 * rather than a second copy of the rule that could drift from it.
 */
export async function canReadBooking(supabase: Client, bookingId: string): Promise<boolean> {
  const { data } = await supabase
    .from('bookings').select('id').eq('id', bookingId).eq('kind', 'rental').maybeSingle()
  return data?.id === bookingId
}

/**
 * Put one file in the bucket, under the booking it belongs to.
 *
 * `bytes` is read before anything else happens, because the size cap and the
 * type whitelist are decided from the CONTENT, not from what the browser
 * claimed the file was.
 */
export async function uploadBookingFile(
  supabase: Client,
  input: {
    bookingId: string
    kind: FileKind
    basename: string
    bytes: Uint8Array
    accept?: readonly SniffedType[]
    contentType?: SniffedType
  },
): Promise<UploadOutcome> {
  if (input.bytes.byteLength === 0) return { ok: false, reason: 'fileType' }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, reason: 'fileTooLarge' }

  const sniffed = input.contentType ?? sniffType(input.bytes)
  const accept = input.accept ?? IMAGE_TYPES
  if (!sniffed || !accept.includes(sniffed)) return { ok: false, reason: 'fileType' }

  if (!(await canReadBooking(supabase, input.bookingId))) return { ok: false, reason: 'forbidden' }

  const path = bookingFilePath(input.bookingId, input.kind, `${input.basename}.${extensionFor(sniffed)}`)

  const { error } = await supabase.storage.from(BOOKING_FILES_BUCKET).upload(path, input.bytes, {
    contentType: sniffed,
    // A re-take replaces the photo it corrects. The update policy allows this
    // for `licences` and `damage` only; a signature or a contract lands on a
    // fresh path and the policy refuses to overwrite either.
    upsert: input.kind === 'licences' || input.kind === 'damage',
  })
  if (error) return { ok: false, reason: 'unknown' }

  return { ok: true, path, type: sniffed }
}

/**
 * A short-lived URL for one stored file, or null.
 *
 * The order matters: parse the path (so a hand-typed one is refused before it
 * reaches the storage API), re-check the booking, rate limit, then sign, then
 * log. Nothing is logged for a request that was refused a URL — a refusal is
 * not an issuance — and the log line carries the booking and the kind, never
 * the licence number or a token (docs/03-SECURITY.md, "Logging").
 */
export async function signBookingFile(
  supabase: Client,
  path: string | null | undefined,
  options: { actorId: string; ttlSeconds?: number },
): Promise<string | null> {
  const parsed = parseBookingFilePath(path)
  if (!parsed) return null

  if (!(await canReadBooking(supabase, parsed.bookingId))) return null

  // A hostile session cannot turn signed-URL issuance into an enumeration
  // loop. The cap is generous: one contract screen legitimately signs both
  // licence images for two drivers plus a handful of damage photos.
  if (!(await allow(`signurl:${options.actorId}`, 300, 300))) return null

  // Re-built from the parsed parts rather than passed through, so whatever the
  // caller handed in cannot reach the storage API un-normalised.
  const safePath = bookingFilePath(parsed.bookingId, parsed.kind, parsed.filename)

  const { data, error } = await supabase.storage
    .from(BOOKING_FILES_BUCKET)
    .createSignedUrl(safePath, options.ttlSeconds ?? DEFAULT_TTL_SECONDS)

  if (error || !data?.signedUrl) return null

  await logSecurityEvent({
    kind: 'signed_url_issued',
    profileId: options.actorId,
    detail: { booking_id: parsed.bookingId, file_kind: parsed.kind },
  })

  return data.signedUrl
}

/** Signs several paths at once, keeping nulls for the ones that were refused. */
export async function signBookingFiles(
  supabase: Client,
  paths: readonly (string | null | undefined)[],
  options: { actorId: string; ttlSeconds?: number },
): Promise<(string | null)[]> {
  return Promise.all(paths.map((p) => signBookingFile(supabase, p, options)))
}

/**
 * The bytes of a stored file, for the server's own use — embedding a signature
 * and the licence images in the contract PDF. It goes through the caller's
 * session like everything else, so the same policy decides it.
 */
export async function readBookingFile(
  supabase: Client, path: string | null | undefined,
): Promise<Uint8Array | null> {
  const parsed = parseBookingFilePath(path)
  if (!parsed) return null

  const safePath = bookingFilePath(parsed.bookingId, parsed.kind, parsed.filename)
  const { data, error } = await supabase.storage.from(BOOKING_FILES_BUCKET).download(safePath)
  if (error || !data) return null

  return new Uint8Array(await data.arrayBuffer())
}

export { BOOKING_FILES_BUCKET }
