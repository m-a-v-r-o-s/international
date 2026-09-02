import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BookingDriverRow, BookingRow, Database, DamageViewCol, HandoverRow, MarkTypeCol,
} from '@/lib/supabase/database.types'
import type { DiagramMark } from '@/app/(app)/bookings/[id]/DamageDiagram'
import { signBookingFiles } from '@/lib/storage/booking-files'
import { sqlNull } from '@/lib/supabase/args'

/**
 * Everything R4 and R5 need about one booking, in one place.
 *
 * `select *` is refused on `bookings` — `block_reason` and `total` are
 * withheld from `authenticated` by column grant — so every column is named
 * (docs/06-IMPLEMENTATION-NOTES.md). RLS decides whether any of this comes
 * back at all: a rep reaching for a booking that is neither theirs nor their
 * hotel's gets an empty result, not a forbidden.
 */
const BOOKING_COLUMNS =
  'id, ref, status, car_id, category_id, hotel_id, room_number, start_date, end_date, ' +
  'pickup_at, dropoff_at, cust_first, cust_last, cust_phone, cust_dob, ' +
  'total, days, collected, pay_method, paid, created_by, returned_at, ' +
  'eligibility_override_at'

export type HandoverBooking = Pick<BookingRow,
  'id' | 'ref' | 'status' | 'car_id' | 'category_id' | 'hotel_id' | 'room_number'
  | 'start_date' | 'end_date' | 'pickup_at' | 'dropoff_at'
  | 'cust_first' | 'cust_last' | 'cust_phone' | 'cust_dob'
  | 'total' | 'days' | 'collected' | 'pay_method' | 'paid' | 'created_by'
  | 'returned_at' | 'eligibility_override_at'>

export type HandoverContext = {
  booking: HandoverBooking
  car: { id: string; plate: string; model_id: string } | null
  model: { make: string; model: string; tank_litres: number | null } | null
  drivers: BookingDriverRow[]
  pickup: Pick<HandoverRow, 'id' | 'kind' | 'fuel_eighths' | 'notes' | 'occurred_at'> | null
  ret: Pick<HandoverRow, 'id' | 'kind' | 'fuel_eighths' | 'notes' | 'occurred_at'> | null
  marksByHandover: Map<string, DiagramMark[]>
}

export async function loadHandoverContext(
  supabase: SupabaseClient<Database>,
  bookingId: string,
  /**
   * Pass the signed-in staff id to get a short-lived URL for each damage
   * photo. It is optional because signing costs a round trip per photo and a
   * screen that only counts marks does not need one — and because a signed URL
   * is issued to a PERSON, logged against them (docs/03-SECURITY.md), so there
   * is no sensible default actor to fall back on.
   */
  actorId?: string,
): Promise<HandoverContext | null> {
  const { data } = await supabase.from('bookings')
    .select(BOOKING_COLUMNS).eq('id', bookingId).eq('kind', 'rental').maybeSingle()
  if (!data) return null
  const booking = data as unknown as HandoverBooking

  const [{ data: car }, { data: drivers }, { data: handovers }] = await Promise.all([
    supabase.from('cars').select('id, plate, model_id').eq('id', booking.car_id).maybeSingle(),
    supabase.from('booking_drivers')
      .select('id, booking_id, is_main, first_name, last_name, dob, licence_number, ' +
              'licence_country, licence_issued_on, licence_expires_on, front_image_path, ' +
              'back_image_path, ocr_confidence, ocr_reviewed, images_purged_at, created_at')
      .eq('booking_id', bookingId)
      .order('is_main', { ascending: false }).order('created_at'),
    supabase.from('handovers')
      .select('id, kind, fuel_eighths, notes, occurred_at').eq('booking_id', bookingId),
  ])

  const { data: model } = car
    ? await supabase.from('car_models').select('make, model, tank_litres').eq('id', car.model_id).maybeSingle()
    : { data: null }

  const handoverIds = (handovers ?? []).map((h) => h.id)
  const { data: marks } = handoverIds.length > 0
    ? await supabase.from('damage_marks')
        .select('id, handover_id, view, x, y, mark_type, note, photo_path, pre_existing, created_at')
        .in('handover_id', handoverIds)
        .order('created_at')
    : { data: [] }

  const rows = marks ?? []
  const photoUrls = actorId
    ? await signBookingFiles(supabase, rows.map((m) => m.photo_path), { actorId })
    : rows.map(() => null)

  const marksByHandover = new Map<string, DiagramMark[]>()
  rows.forEach((mark, index) => {
    const list = marksByHandover.get(mark.handover_id) ?? []
    // numeric(5,4) arrives as a string over PostgREST; coerce once, here.
    list.push({
      id: mark.id,
      // CHECK-constrained text — see src/lib/supabase/database.types.ts.
      view: mark.view as DamageViewCol,
      x: Number(mark.x),
      y: Number(mark.y),
      mark_type: mark.mark_type as MarkTypeCol,
      note: mark.note,
      hasPhoto: mark.photo_path !== null,
      photoUrl: photoUrls[index] ?? null,
    })
    marksByHandover.set(mark.handover_id, list)
  })

  return {
    booking,
    car: car ?? null,
    model: model ?? null,
    drivers: (drivers ?? []) as unknown as BookingDriverRow[],
    // `handovers.kind` is CHECK-constrained text; the find() predicate is the
    // same value the constraint permits.
    pickup: ((handovers ?? []).find((h) => h.kind === 'pickup') ?? null) as
      Pick<HandoverRow, 'id' | 'kind' | 'fuel_eighths' | 'notes' | 'occurred_at'> | null,
    ret: ((handovers ?? []).find((h) => h.kind === 'return') ?? null) as
      Pick<HandoverRow, 'id' | 'kind' | 'fuel_eighths' | 'notes' | 'occurred_at'> | null,
    marksByHandover,
  }
}

/**
 * The eligibility gate's reasons, per driver (docs/01-DECISIONS.md §11).
 *
 * check_eligibility() returns codes, not sentences, and the minimum age and
 * minimum licence-held period are columns on `categories` that the admin
 * edits — 21 and 23 are never hard-coded in application logic. This screen
 * only ever DISPLAYS the answer: the block itself is enforced by
 * app.assert_drivers_eligible() on the booked → out transition, so there is no
 * way to reach `out` by not calling this.
 */
export async function checkDriverEligibility(
  supabase: SupabaseClient<Database>,
  categoryId: string,
  drivers: BookingDriverRow[],
  start: string,
  end: string,
): Promise<{ driver: BookingDriverRow; ok: boolean; failures: string[] }[]> {
  return Promise.all(drivers.map(async (driver) => {
    const { data, error } = await supabase.rpc('check_eligibility', {
      p_category_id: categoryId,
      p_dob: driver.dob,
      // Both columns are nullable and a null is the POINT: check_eligibility()
      // answers 'licence_issue_date_missing' / 'licence_expiry_missing' for it,
      // which is a §11 failure the gate must report rather than a bad call. The
      // generated Args type models a parameter with no DEFAULT as non-nullable,
      // so the cast is what keeps a missing date reaching the function.
      p_licence_issued_on: sqlNull(driver.licence_issued_on),
      p_licence_expires_on: sqlNull(driver.licence_expires_on),
      p_start: start,
      p_end: end,
    })
    const row = data?.[0]
    if (error || !row) return { driver, ok: false, failures: ['unknown'] }
    return { driver, ok: row.ok, failures: row.failures ?? [] }
  }))
}
