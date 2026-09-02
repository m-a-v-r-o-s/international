import { z } from 'zod'

/**
 * R3b · the booking confirmation taken over the phone
 * (docs/01-DECISIONS.md §30 decision 2).
 *
 * A guest rings the desk and orders a car. What the rep can actually get out
 * of that call is a number, a room, a car, some dates and whether there are
 * children — and the owner's instruction was to collect ONLY those. This
 * schema is R3's with the identity taken out of it, and it exists as its own
 * module rather than inside the server action so the rules can be tested
 * without a request around them.
 *
 * What it is NOT is a second way to write a booking. The row it produces goes
 * through the same insert, the same guard trigger and the same exclusion
 * constraint as R3's — a phone booking that double-books a car is refused with
 * the same 23P01 as any other. `bookings.cust_first`, `cust_last` and
 * `cust_dob` have been nullable since Phase 1; this is simply the first path
 * that leaves them so deliberately, and the pickup flow fills them in from the
 * licence when the guest is standing there (§9, §10).
 *
 * The name is optional rather than absent, against the letter of "collect
 * only". R1 Today and A1 Movements both print a guest name per row, and a
 * booking with none shows a blank there until the contract is written — so a
 * rep who was given a name on the call can record it, and a rep who was not
 * is never held up by a required field. It is never required, of either role.
 */

const uuid = z.string().uuid()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const time = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional()
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => v || null)

/** Baby seats, exactly as `booking_extras.seat_type` already enumerates them (§9). */
export const SEAT_TYPES = ['infant', 'child', 'booster'] as const
export type SeatType = (typeof SEAT_TYPES)[number]

/** Every car carries at most this many of any one seat type — the owner's number, not the database's (which allows up to 4). */
export const MAX_SEAT_QTY = 3

/**
 * The form posts one `seat` value per unit wanted (three child seats is
 * three `seat=child` entries), the same shape a plain checkbox already
 * produced when at most one of each was possible. This turns that flat list
 * into the `{seat, qty}` rows `booking_extras` actually stores, capping each
 * type at `MAX_SEAT_QTY` in case a tampered request posts more than the UI
 * allows.
 */
export function groupSeatExtras(seats: readonly SeatType[]): { seat: SeatType; qty: number }[] {
  const counts = new Map<SeatType, number>()
  for (const seat of seats) counts.set(seat, Math.min(MAX_SEAT_QTY, (counts.get(seat) ?? 0) + 1))
  return [...counts.entries()].map(([seat, qty]) => ({ seat, qty }))
}

/**
 * Where the rep lands afterwards, and the only reason one action serves two
 * screens. The header's "booking confirmation" leaves them on the slip;
 * the walk-in path continues straight into licence capture, because to the rep
 * that was one transaction and not two errands.
 */
export const QUICK_BOOKING_NEXT = ['detail', 'pickup'] as const
export type QuickBookingNext = (typeof QUICK_BOOKING_NEXT)[number]

export const quickBookingSchema = z.object({
  car_id: uuid,
  hotel_id: uuid,
  room_number: optionalText(16),
  start_date: date,
  end_date: date,
  // The one thing the call always yields, and the key the ledger matches a
  // returning guest on (§25a). Never optional.
  cust_phone: z.string().trim().min(4).max(32),
  cust_first: optionalText(80),
  cust_last: optionalText(80),
  // Required so the confirmation (pickup time, cost, licence requirements)
  // always has somewhere to go — UNLESS the boss is making an exception
  // booking, in which case nothing on the form is mandatory
  // (docs/01-DECISIONS.md §37). Format and MX-record checking happen in the
  // action, not here — this schema only shapes the field.
  cust_email: optionalText(254),
  pickup_time: time,
  dropoff_time: time,
  // The exception path (docs/01-DECISIONS.md §5, §37). Shaped here, allowed
  // only for an admin in the action, and forced off for a rep by
  // app.bookings_before_write() underneath both — an unflagged out-of-window
  // pick-up is refused by the database regardless.
  pickup_exception: z.boolean().optional().default(false),
  pickup_exception_reason: optionalText(300),
  seats: z.array(z.enum(SEAT_TYPES)).optional().default([]),
  next: z.enum(QUICK_BOOKING_NEXT).optional().default('detail'),
}).refine((v) => v.end_date >= v.start_date, { path: ['end_date'] })

export type QuickBooking = z.infer<typeof quickBookingSchema>

/**
 * The form's fields, read the same way in the action and in its tests.
 *
 * `next` is read from the body and validated against the enum rather than
 * trusted: it decides a redirect, and an unchecked redirect target taken from
 * a form is an open redirect however innocuous the two allowed values look.
 */
export function parseQuickBooking(formData: FormData):
  { ok: true; data: QuickBooking } | { ok: false } {
  const parsed = quickBookingSchema.safeParse({
    car_id: formData.get('car_id'),
    hotel_id: formData.get('hotel_id'),
    room_number: formData.get('room_number') || undefined,
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date'),
    cust_phone: formData.get('cust_phone'),
    cust_first: formData.get('cust_first') || undefined,
    cust_last: formData.get('cust_last') || undefined,
    cust_email: formData.get('cust_email') || undefined,
    pickup_time: formData.get('pickup_time') || undefined,
    dropoff_time: formData.get('dropoff_time') || undefined,
    pickup_exception: formData.get('pickup_exception') === 'on',
    pickup_exception_reason: formData.get('pickup_exception_reason') || undefined,
    seats: formData.getAll('seat'),
    next: formData.get('next') || undefined,
  })
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false }
}
