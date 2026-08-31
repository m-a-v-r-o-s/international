/**
 * The shapes a booking-creation screen is handed, in a module a client
 * component may import.
 *
 * They live here rather than in desk.ts because that file is `server-only`:
 * the loader must never be pulled into a browser bundle, but the types it
 * returns are read by the forms it feeds, and a type import that has to be
 * `import type` to stay safe is a rule someone eventually forgets.
 */
export type Hotel = { id: string; name: string; area: string | null }

/** The admin's default pick-up and drop-off windows (docs/01-DECISIONS.md §5). */
export type BookingWindows = {
  pickupFrom: string
  pickupTo: string
  dropoffFrom: string
  dropoffTo: string
}
