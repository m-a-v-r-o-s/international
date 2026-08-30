/**
 * Turns a Supabase/PostgREST error into the message-catalogue key that
 * explains it, so a form can show "no price is set for that category" instead
 * of "something went wrong". PostgREST forwards the Postgres SQLSTATE as
 * `error.code`, and the engines and guards in `supabase/migrations` raise
 * their errors with exactly the SQLSTATEs listed in `messages/en.json`'s
 * `errors` block (IR100…IR121) — so the code is the key, verbatim.
 *
 * `42501` is Postgres's own "insufficient privilege", thrown by RLS itself
 * rather than by application code; it always means the same thing here.
 */
const KNOWN_CODES = new Set([
  'IR001', 'IR100', 'IR101', 'IR102', 'IR103', 'IR104', 'IR105', 'IR106',
  'IR107', 'IR108', 'IR109', 'IR110', 'IR111', 'IR112', 'IR113', 'IR114', 'IR120', 'IR121',
])

export type ErrorKey =
  | 'IR001' | 'IR100' | 'IR101' | 'IR102' | 'IR103' | 'IR104' | 'IR105' | 'IR106'
  | 'IR107' | 'IR108' | 'IR109' | 'IR110' | 'IR111' | 'IR112' | 'IR113' | 'IR114' | 'IR120' | 'IR121'
  | 'forbidden' | 'conflict' | 'unknown'
  // Raised by the app rather than by Postgres: a file the upload path refused
  // before it ever reached the bucket, and the caps around the OCR call.
  | 'fileType' | 'fileTooLarge' | 'rateLimited' | 'ocrFailed'

/** The Postgres exclusion constraint on `bookings` — the double-booking guarantee. */
const EXCLUSION_VIOLATION = '23P01'

export function errorKey(error: { code?: string | null; message?: string } | null): ErrorKey {
  if (!error) return 'unknown'
  const code = error.code ?? ''

  if (code === EXCLUSION_VIOLATION) return 'conflict'
  if (code === '42501') return 'forbidden'
  if (KNOWN_CODES.has(code)) return code as ErrorKey

  return 'unknown'
}
