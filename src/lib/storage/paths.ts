/**
 * The shape of every object in the private `booking-files` bucket.
 *
 *     <booking_id>/<kind>/<filename>
 *
 * The path is not a filing convenience — it IS the authorisation key. The RLS
 * policies in supabase/migrations/20260830120000_storage.sql read segment 1 as
 * the booking and hand it to app.can_read_booking(), and read segment 2 as the
 * kind to decide whether the object may be replaced or deleted at all. So this
 * module and that migration are two halves of one rule, and neither may change
 * without the other.
 *
 * It is deliberately pure and free of any server import, so the round trip is
 * unit-testable without a database (tests/unit/storage-paths.test.ts) and the
 * database half is exercised against the real policies
 * (tests/db/storage-isolation.test.ts).
 */
export const BOOKING_FILES_BUCKET = 'booking-files'

/**
 * `licences` is the only kind the retention job sweeps
 * (docs/01-DECISIONS.md §25): licence images are auto-deleted after the
 * admin's window, while the signature and the contract PDF are retained. That
 * is why they are separate folders rather than one `files` folder with a
 * naming convention — a purge that has to parse filenames to decide what to
 * keep is a purge that will one day delete a contract.
 */
export const FILE_KINDS = ['licences', 'damage', 'signature', 'contract'] as const
export type FileKind = (typeof FILE_KINDS)[number]

/** Kinds a rep may overwrite or delete — mirrors the update/delete policies. */
export const REPLACEABLE_KINDS: readonly FileKind[] = ['licences', 'damage']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** No slashes, no dot segments, no control characters: one flat filename. */
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

export function bookingFilePath(bookingId: string, kind: FileKind, filename: string): string {
  if (!UUID.test(bookingId)) throw new Error('bookingFilePath: booking id must be a uuid')
  if (!FILENAME.test(filename) || filename.includes('..')) {
    throw new Error('bookingFilePath: unsafe filename')
  }
  return `${bookingId}/${kind}/${filename}`
}

export type ParsedBookingFilePath = {
  bookingId: string
  kind: FileKind
  filename: string
}

/**
 * The inverse, and the guard on anything that arrives from a client. A path is
 * accepted only if it is exactly three segments, the first a uuid and the
 * second a known kind — so `../`, a bare filename and another bucket's layout
 * are all a plain null rather than something to reason about downstream.
 */
export function parseBookingFilePath(path: string | null | undefined): ParsedBookingFilePath | null {
  if (typeof path !== 'string') return null
  const parts = path.split('/')
  if (parts.length !== 3) return null

  const [bookingId, kind, filename] = parts as [string, string, string]
  if (!UUID.test(bookingId)) return null
  if (!(FILE_KINDS as readonly string[]).includes(kind)) return null
  if (!FILENAME.test(filename) || filename.includes('..')) return null

  return { bookingId, kind: kind as FileKind, filename }
}

/** The booking a stored path belongs to, or null if the path is not one of ours. */
export function bookingIdFromPath(path: string | null | undefined): string | null {
  return parseBookingFilePath(path)?.bookingId ?? null
}
