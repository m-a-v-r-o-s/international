import type { supabaseServer } from '@/lib/supabase/server'
import type { BookingRow } from '@/lib/supabase/database.types'

const COLUMNS =
  'id, ref, status, car_id, hotel_id, adhoc_hotel_name, room_number, start_date, end_date, ' +
  'pickup_at, dropoff_at, cust_first, cust_last'

export type Movement = Pick<BookingRow,
  'id' | 'ref' | 'status' | 'car_id' | 'hotel_id' | 'adhoc_hotel_name' | 'room_number'
  | 'start_date' | 'end_date' | 'pickup_at' | 'dropoff_at' | 'cust_first' | 'cust_last'>

export type DayMovements = {
  pickups: Movement[]
  returns: Movement[]
  carById: Map<string, { id: string; plate: string; model_id: string }>
  modelById: Map<string, { id: string; make: string; model: string }>
  hotelById: Map<string, string>
}

/**
 * Today's pickups and drop-offs, shared by the Today screen and the
 * dedicated Pickups/Drop-offs screens (R1, docs/04-SCREENS.md) so all three
 * agree on one set of rows.
 *
 * A pickup stays listed through 'out' and a drop-off through 'returned'
 * rather than dropping out once done — the rep's checklist for the day is
 * everything due today, ticked off as it's completed, not just what's still
 * outstanding.
 */
export async function loadDayMovements(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  today: string,
): Promise<DayMovements> {
  // Every booking on the day is shown. An exception booking used to be held
  // back until the boss approved it; since §37 there is nothing to approve —
  // he made it himself — and a 03:00 pick-up is the one a rep most needs to
  // be told about.
  const [{ data: pickupRows }, { data: returnRows }] = await Promise.all([
    supabase.from('bookings').select(COLUMNS)
      .eq('kind', 'rental').eq('start_date', today).in('status', ['booked', 'out', 'returned']),
    supabase.from('bookings').select(COLUMNS)
      .eq('kind', 'rental').eq('end_date', today).in('status', ['out', 'returned']),
  ])

  const pickups = ((pickupRows ?? []) as unknown as Movement[])
    .sort((a, b) => (a.pickup_at ?? '').localeCompare(b.pickup_at ?? ''))
  const returns = ((returnRows ?? []) as unknown as Movement[])
    .sort((a, b) => (a.dropoff_at ?? '').localeCompare(b.dropoff_at ?? ''))

  const carIds = [...new Set([...pickups, ...returns].map((b) => b.car_id))]
  const hotelIds = [...new Set([...pickups, ...returns]
    .map((b) => b.hotel_id).filter((h): h is string => h !== null))]

  const [{ data: cars }, { data: hotels }] = await Promise.all([
    carIds.length > 0
      ? supabase.from('cars').select('id, plate, model_id').in('id', carIds)
      : Promise.resolve({ data: [] }),
    hotelIds.length > 0
      ? supabase.from('hotels').select('id, name').in('id', hotelIds)
      : Promise.resolve({ data: [] }),
  ])

  const modelIds = [...new Set((cars ?? []).map((c) => c.model_id))]
  const { data: models } = modelIds.length > 0
    ? await supabase.from('car_models').select('id, make, model').in('id', modelIds)
    : { data: [] }

  return {
    pickups,
    returns,
    carById: new Map((cars ?? []).map((c) => [c.id, c])),
    modelById: new Map((models ?? []).map((m) => [m.id, m])),
    hotelById: new Map((hotels ?? []).map((h) => [h.id, h.name])),
  }
}

/** Registered hotel, or the free-text name of one that isn't (docs/01-DECISIONS.md §41). */
export function movementLocation(
  m: Pick<Movement, 'hotel_id' | 'adhoc_hotel_name'>, hotelById: Map<string, string>,
): string | undefined {
  return (m.hotel_id ? hotelById.get(m.hotel_id) : m.adhoc_hotel_name) ?? undefined
}

/** 24-hour, in Athens: the only clock the reps and the boss share. */
export function fmtTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Athens',
      })
    : '–'
}
