import type { supabaseServer } from '@/lib/supabase/server'
import { addDays } from '@/lib/dates'
import type { BookingRow, CarRow, HotelRow } from '@/lib/supabase/database.types'

/**
 * A13 · the overnight car shuffle (docs/01-DECISIONS.md §45, docs/04-SCREENS.md).
 *
 * A1 says what happens today. This says what has to happen *between* today and
 * tomorrow: a car dropped at Μικρή Πόλη at 21:00 and booked at Belvedere at
 * 09:00 has to be driven across in the dark, and that journey appears on no
 * booking, belongs to no rental and was on nobody's screen.
 *
 * Every row here is DERIVED on read. Nothing about tonight is stored except the
 * boss's own decisions (`car_relocations`), because a stored sheet would go
 * stale the moment a rental is extended or a car is swapped — and a stale
 * shuffle sheet sends somebody to the wrong hotel at midnight, which is the
 * exact failure the paper one had.
 *
 * The derivation itself is `buildRelocationRows()` and takes plain rows, so it
 * is tested directly rather than through a database (tests/unit/relocations.test.ts)
 * — the same split as availability-filters.ts.
 */

const BOOKING_COLUMNS =
  'id, ref, car_id, hotel_id, adhoc_hotel_name, start_date, end_date, ' +
  'pickup_at, dropoff_at, cust_first, cust_last, status'

export type RelocationBooking = Pick<BookingRow,
  'car_id' | 'hotel_id' | 'adhoc_hotel_name' | 'pickup_at' | 'dropoff_at'
  | 'cust_first' | 'cust_last'>

export type RelocationCar = Pick<CarRow, 'id' | 'plate' | 'model_id' | 'stationed_at'>

export type RelocationDecision = {
  car_id: string
  to_hotel_id: string | null
  done_at: string | null
}

/** A location, however it is named: a registered hotel, or free text (§42). */
export type Place = {
  hotelId: string | null
  /** The display name. Null only when a car has never been placed at all. */
  label: string | null
  /** True when this is an `adhoc_hotel_name`, which no FK can point at. */
  adhoc: boolean
}

export type RelocationRow = {
  carId: string
  plate: string
  model: string | null
  /** Where the car will be when the night starts. */
  from: Place
  /** Where it has to be by morning. `hotelId` and `label` null = stays put. */
  to: Place
  /** Why the row is on the board at all. */
  reason: 'return' | 'idle' | 'manual'
  /** The boss has decided this one himself — `to` is his, not the derivation's. */
  overridden: boolean
  doneAt: string | null
  /** Set when the car is coming back tonight: who had it, and when it lands. */
  guest: string | null
  dropoffAt: string | null
  /** The morning booking that demands the car, when there is one. */
  pickupAt: string | null
}

export type RelocationBoard = {
  night: string
  morning: string
  rows: RelocationRow[]
  /** Every hotel a car may be sent to, depots first. */
  destinations: Pick<HotelRow, 'id' | 'name' | 'area' | 'is_depot'>[]
}

const NO_PLACE: Place = { hotelId: null, label: null, adhoc: false }

/** A booking's location, registered or not (§42, mirrors movementLocation()). */
function placeOfBooking(
  b: Pick<RelocationBooking, 'hotel_id' | 'adhoc_hotel_name'>,
  hotelById: Map<string, string>,
): Place {
  if (b.hotel_id) {
    return { hotelId: b.hotel_id, label: hotelById.get(b.hotel_id) ?? null, adhoc: false }
  }
  if (b.adhoc_hotel_name) {
    return { hotelId: null, label: b.adhoc_hotel_name, adhoc: true }
  }
  return NO_PLACE
}

function placeOfHotel(id: string | null, hotelById: Map<string, string>): Place {
  return id ? { hotelId: id, label: hotelById.get(id) ?? null, adhoc: false } : NO_PLACE
}

function samePlace(a: Place, b: Place): boolean {
  if (a.hotelId !== null || b.hotelId !== null) return a.hotelId === b.hotelId
  // Two ad-hoc names, or two unknowns. Free text is compared as text, trimmed
  // and case-folded, because "Villa Rosa" and "villa rosa " are one hotel.
  const norm = (p: Place) => p.label?.trim().toLocaleLowerCase() ?? null
  return norm(a) === norm(b)
}

/**
 * The derivation, over rows somebody else fetched.
 *
 * Three things put a car on the board:
 *
 *   1. It comes back tonight. Always listed, even when it has nowhere to go —
 *      that is the list the boss reads to decide whether to send it somewhere
 *      anyway, which is the whole point of letting him invent a destination.
 *   2. It is idle somewhere and booked tomorrow morning somewhere else. Easy
 *      to miss and the most expensive to miss: nothing happened to this car
 *      today, so it appears on no other screen, and the guest still arrives at
 *      09:00 to find an empty space.
 *   3. He has decided something about it himself.
 *
 * The horizon is exactly one night. A booking three days out is not tonight's
 * problem, so such a car reads as "stays" until the night before it is due.
 */
export function buildRelocationRows({
  returns, pickups, decisions, cars, hotelById, modelById,
}: {
  returns: RelocationBooking[]
  pickups: RelocationBooking[]
  decisions: RelocationDecision[]
  cars: RelocationCar[]
  hotelById: Map<string, string>
  modelById: Map<string, string>
}): RelocationRow[] {
  const carById = new Map(cars.map((c) => [c.id, c]))

  // One booking per car per side. Both are guaranteed unique by the exclusion
  // constraint on `bookings` — a car cannot have two live rentals touching the
  // same date — so the first match is the only match.
  const returnByCar = new Map(returns.map((b) => [b.car_id, b]))
  const pickupByCar = new Map(pickups.map((b) => [b.car_id, b]))
  const decisionByCar = new Map(decisions.map((d) => [d.car_id, d]))

  const candidates = new Set<string>([
    ...returnByCar.keys(), ...pickupByCar.keys(), ...decisionByCar.keys(),
  ])

  const rows: RelocationRow[] = []

  for (const carId of candidates) {
    const car = carById.get(carId)
    if (!car) continue     // archived, or deleted since the booking was made

    const back = returnByCar.get(carId)
    const next = pickupByCar.get(carId)
    const decision = decisionByCar.get(carId)

    // Where it will be tonight: a car coming back is at the hotel it is
    // returned to, whatever its standing base says. Otherwise its base is the
    // only thing anyone knows.
    const from = back
      ? placeOfBooking(back, hotelById)
      : placeOfHotel(car.stationed_at, hotelById)

    const derivedTo = next ? placeOfBooking(next, hotelById) : NO_PLACE
    const to = decision ? placeOfHotel(decision.to_hotel_id, hotelById) : derivedTo

    const reason: RelocationRow['reason'] = back ? 'return' : next ? 'idle' : 'manual'

    // An idle car with nothing to do is not news. A returning car always is,
    // and so is anything the boss has touched.
    if (reason === 'idle' && samePlace(from, derivedTo)) continue

    rows.push({
      carId,
      plate: car.plate,
      model: modelById.get(car.model_id) ?? null,
      from,
      to: samePlace(from, to) ? NO_PLACE : to,
      reason,
      overridden: decision !== undefined,
      doneAt: decision?.done_at ?? null,
      guest: back ? `${back.cust_first ?? ''} ${back.cust_last ?? ''}`.trim() || null : null,
      dropoffAt: back?.dropoff_at ?? null,
      pickupAt: next?.pickup_at ?? null,
    })
  }

  // The moves lead, because they are the work. Within each half, grouped by
  // where the driving starts — that is how the night is actually run: one
  // person clears Μικρή Πόλη, then moves on.
  return rows.sort((a, b) => {
    const moves = (r: RelocationRow) => (r.to.label !== null ? 0 : 1)
    return moves(a) - moves(b)
      || (a.from.label ?? '￿').localeCompare(b.from.label ?? '￿')
      || a.plate.localeCompare(b.plate)
  })
}

/** One night's board, fetched and derived. `night` is the evening it runs on. */
export async function loadRelocationBoard(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  night: string,
): Promise<RelocationBoard> {
  const morning = addDays(night, 1)

  const [
    { data: returnRows }, { data: pickupRows }, { data: decisionRows },
    { data: carRows }, { data: hotelRows },
  ] = await Promise.all([
    // Coming back tonight. `returned` is included as well as `out`: the boss
    // reads this screen in the evening, by which time some of tonight's cars
    // are already back, and a car that has landed still has to be driven on.
    supabase.from('bookings').select(BOOKING_COLUMNS)
      .eq('kind', 'rental').eq('end_date', night).in('status', ['out', 'returned']),
    // Wanted tomorrow morning. A cancelled or no-show booking makes no demand.
    supabase.from('bookings').select(BOOKING_COLUMNS)
      .eq('kind', 'rental').eq('start_date', morning).in('status', ['booked', 'out']),
    supabase.from('car_relocations').select('car_id, to_hotel_id, done_at').eq('night_of', night),
    supabase.from('cars').select('id, plate, model_id, stationed_at, archived_at').order('plate'),
    supabase.from('hotels').select('id, name, area, is_depot, active').order('name'),
  ])

  const cars = ((carRows ?? []) as (RelocationCar & { archived_at: string | null })[])
    .filter((c) => c.archived_at === null)
  const hotels = (hotelRows ?? []) as Pick<HotelRow, 'id' | 'name' | 'area' | 'is_depot' | 'active'>[]

  const modelIds = [...new Set(cars.map((c) => c.model_id))]
  const { data: models } = modelIds.length > 0
    ? await supabase.from('car_models').select('id, make, model').in('id', modelIds)
    : { data: [] }

  return {
    night,
    morning,
    rows: buildRelocationRows({
      returns: (returnRows ?? []) as unknown as RelocationBooking[],
      pickups: (pickupRows ?? []) as unknown as RelocationBooking[],
      decisions: (decisionRows ?? []) as RelocationDecision[],
      cars,
      hotelById: new Map(hotels.map((h) => [h.id, h.name])),
      modelById: new Map((models ?? []).map((m) => [m.id, `${m.make} ${m.model}`])),
    }),
    // Inactive hotels are gone from the picker (nothing new should be sent
    // there) but stay resolvable above, so a decision already made against one
    // still reads correctly. Depots first: the yard is the commonest answer.
    destinations: hotels
      .filter((h) => h.active)
      .sort((a, b) => Number(b.is_depot) - Number(a.is_depot) || a.name.localeCompare(b.name))
      .map(({ id, name, area, is_depot }) => ({ id, name, area, is_depot })),
  }
}

/** 24-hour, in Athens — the one clock the boss and the reps share (A1). */
export function fmtTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Athens',
      })
    : '–'
}
