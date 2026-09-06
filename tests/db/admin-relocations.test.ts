import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { bookAsRep, seed, type Fixtures } from '../helpers/fixtures'

// A13 · the overnight car shuffle (docs/01-DECISIONS.md §45).
//
// Two guarantees are worth a test each, and neither lives in the screen:
//
//   1. `cars.stationed_at` is in NO client update grant, for either role. The
//      three SECURITY DEFINER functions are not the tidy path, they are the
//      only path — so a crafted PostgREST call cannot move a car's base, and
//      neither can the admin's own session by writing the column directly.
//   2. Ticking a move off writes the relocation row AND the car's base. A
//      sheet that says the car is at Beta while the fleet list says Alpha is
//      the one failure that sends somebody to the wrong hotel at midnight, so
//      the two writes are one function.
//
// The self-correcting trigger is here too, because "the column ships empty and
// fills itself as cars come back" is a claim the migration makes and only a
// test can keep honest.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.sql(`delete from public.car_relocations`)
  await db.sql(`update public.cars set stationed_at = null`)
})

/**
 * A rental taken to `out` the way R4 does it — a driver and a pickup handover
 * included, because the eligibility guard refuses the transition without one.
 */
async function rentalOut(carId: string, hotel: string | null, adhoc?: string) {
  const bookingId = await bookAsRep(db, f.repA, {
    carId, hotelId: hotel, adhocHotelName: adhoc ?? null,
    start: '2026-06-10', end: '2026-06-12',
  })

  await db.asUser(f.repA, () => db.sql(
    `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob,
       licence_number, licence_country, licence_issued_on, licence_expires_on)
     values ($1, true, 'Anna', 'Driver', '1985-04-02', 'GR1', 'GR', '2010-06-01', '2032-06-01')`,
    [bookingId]))

  await db.asUser(f.repA, () => db.sql(
    `insert into public.handovers (booking_id, kind, by_profile, fuel_eighths)
     values ($1, 'pickup', $2, 8)`, [bookingId, f.repA]))

  await db.asUser(f.repA, () => db.sql(
    `update public.bookings set status = 'out' where id = $1`, [bookingId]))

  return bookingId
}

async function stationOf(carId: string) {
  const row = await db.one<{ stationed_at: string | null }>(
    `select stationed_at from public.cars where id = $1`, [carId])
  return row.stationed_at
}

describe('nobody writes cars.stationed_at directly', () => {
  test('a rep updating the column is refused for want of the grant', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.cars set stationed_at = $2 where id = $1`, [f.car1, f.hotelA]))))
      .toBe('42501')
  })

  test('the admin updating the column is refused too — the grant, not the policy', async () => {
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `update public.cars set stationed_at = $2 where id = $1`, [f.car1, f.hotelA]))))
      .toBe('42501')
  })

  test('but a rep may READ it, the same as a plate or a colour', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_car_station($1, $2)`, [f.car1, f.hotelA]))

    const seen = await db.asUser(f.repA, () => db.one<{ stationed_at: string | null }>(
      `select stationed_at from public.cars where id = $1`, [f.car1]))
    expect(seen.stationed_at).toBe(f.hotelA)
  })
})

describe('the relocation table is the admin\'s alone', () => {
  test('a rep selecting from it gets an empty set, not an error', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_relocation('2026-06-12', $1, $2)`, [f.car1, f.hotelB]))

    const rows = await db.asUser(f.repA, () => db.sql(`select * from public.car_relocations`))
    expect(rows).toEqual([])

    const asAdmin = await db.asUser(f.admin, () => db.sql(`select * from public.car_relocations`))
    expect(asAdmin).toHaveLength(1)
  })

  test('a rep cannot insert into it — no grant at all', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.car_relocations (night_of, car_id, to_hotel_id, decided_by)
       values ('2026-06-12', $1, $2, $3)`, [f.car1, f.hotelB, f.repA]))))
      .toBe('42501')
  })

  test('every one of the four functions refuses a rep (IR001)', async () => {
    for (const call of [
      `select public.admin_set_relocation('2026-06-12', '${f.car1}', '${f.hotelB}')`,
      `select public.admin_clear_relocation('2026-06-12', '${f.car1}')`,
      `select public.admin_complete_relocation('2026-06-12', '${f.car1}', '${f.hotelB}')`,
      `select public.admin_set_car_station('${f.car1}', '${f.hotelB}')`,
    ]) {
      expect(await errcode(() => db.asUser(f.repA, () => db.sql(call)))).toBe('IR001')
    }
  })
})

describe('a return places the car by itself', () => {
  test('returning a rental sets the car\'s base to the booking\'s hotel', async () => {
    const bookingId = await rentalOut(f.car1, f.hotelB)
    expect(await stationOf(f.car1)).toBeNull()

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'returned' where id = $1`, [bookingId]))

    expect(await stationOf(f.car1)).toBe(f.hotelB)
  })

  test('a pickup does NOT move it — the base is where the car belongs, not where it is', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_car_station($1, $2)`, [f.car2, f.hotelA]))

    await rentalOut(f.car2, f.hotelB)

    expect(await stationOf(f.car2)).toBe(f.hotelA)
  })

  test('a return to an unregistered hotel leaves the base alone (§42 — free text has no FK)', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_car_station($1, $2)`, [f.car3, f.hotelA]))

    const bookingId = await rentalOut(f.car3, null, 'Villa Rosa')
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'returned' where id = $1`, [bookingId]))

    expect(await stationOf(f.car3)).toBe(f.hotelA)
  })
})

describe('the boss decides, and the decision is one row', () => {
  test('a destination is recorded, and re-recording the same night updates in place', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_relocation('2026-06-12', $1, $2)`, [f.car1, f.hotelA]))
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_relocation('2026-06-12', $1, $2)`, [f.car1, f.hotelB]))

    const rows = await db.sql<{ to_hotel_id: string }>(
      `select to_hotel_id from public.car_relocations where night_of = '2026-06-12' and car_id = $1`,
      [f.car1])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.to_hotel_id).toBe(f.hotelB)
  })

  test('a null destination is a decision too: "stays put", stored as a row', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_relocation('2026-06-12', $1, null)`, [f.car1]))

    const row = await db.one<{ to_hotel_id: string | null }>(
      `select to_hotel_id from public.car_relocations where car_id = $1`, [f.car1])
    expect(row.to_hotel_id).toBeNull()
  })

  test('re-deciding a move that was already done clears the tick', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_complete_relocation('2026-06-12', $1, $2)`, [f.car1, f.hotelA]))
    expect((await db.one<{ done_at: string | null }>(
      `select done_at from public.car_relocations where car_id = $1`, [f.car1])).done_at)
      .not.toBeNull()

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_relocation('2026-06-12', $1, $2)`, [f.car1, f.hotelB]))

    expect((await db.one<{ done_at: string | null }>(
      `select done_at from public.car_relocations where car_id = $1`, [f.car1])).done_at)
      .toBeNull()
  })

  test('re-deciding the SAME destination leaves the tick standing', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_complete_relocation('2026-06-12', $1, $2)`, [f.car1, f.hotelA]))
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_relocation('2026-06-12', $1, $2)`, [f.car1, f.hotelA]))

    expect((await db.one<{ done_at: string | null }>(
      `select done_at from public.car_relocations where car_id = $1`, [f.car1])).done_at)
      .not.toBeNull()
  })

  test('clearing it removes the row, so the night goes back to what the bookings imply', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_relocation('2026-06-12', $1, $2)`, [f.car1, f.hotelB]))
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_clear_relocation('2026-06-12', $1)`, [f.car1]))

    expect(await db.sql(`select * from public.car_relocations where car_id = $1`, [f.car1]))
      .toEqual([])
  })

  test('one row per car per night, and different nights are different rows', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_relocation('2026-06-12', $1, $2)`, [f.car1, f.hotelB]))
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_relocation('2026-06-13', $1, $2)`, [f.car1, f.hotelA]))

    expect(await db.sql(`select * from public.car_relocations where car_id = $1`, [f.car1]))
      .toHaveLength(2)
  })
})

describe('ticking a move off moves the car with it', () => {
  test('done_at and the car\'s base are written together', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_complete_relocation('2026-06-12', $1, $2)`, [f.car1, f.hotelB]))

    const row = await db.one<{ done_at: string | null; to_hotel_id: string }>(
      `select done_at, to_hotel_id from public.car_relocations where car_id = $1`, [f.car1])
    expect(row.done_at).not.toBeNull()
    expect(row.to_hotel_id).toBe(f.hotelB)
    expect(await stationOf(f.car1)).toBe(f.hotelB)
  })

  test('a completed move with no destination is refused (IR104)', async () => {
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select public.admin_complete_relocation('2026-06-12', $1, null)`, [f.car1]))))
      .toBe('IR104')
    expect(await stationOf(f.car1)).toBeNull()
  })

  test('the table itself refuses a tick with no destination, whatever writes it', async () => {
    expect(await errcode(() => db.sql(
      `insert into public.car_relocations (night_of, car_id, to_hotel_id, done_at, decided_by)
       values ('2026-06-12', $1, null, now(), $2)`, [f.car1, f.admin])))
      .toBe('23514')
  })

  test('clearing a done move does not walk the car back — it was driven', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_complete_relocation('2026-06-12', $1, $2)`, [f.car1, f.hotelB]))
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_clear_relocation('2026-06-12', $1)`, [f.car1]))

    expect(await stationOf(f.car1)).toBe(f.hotelB)
  })
})

describe('the office is a hotel with a flag on it', () => {
  test('an admin may mark and unmark a depot; a rep may do neither', async () => {
    await db.asUser(f.admin, () => db.sql(
      `update public.hotels set is_depot = true where id = $1`, [f.hotelA]))
    expect((await db.one<{ is_depot: boolean }>(
      `select is_depot from public.hotels where id = $1`, [f.hotelA])).is_depot).toBe(true)

    // RLS hides the row from a rep's UPDATE rather than raising: the column is
    // in the table-level grant, so it is the `hotels_admin_write` policy that
    // holds here, and a policy silently matches nothing.
    const touched = await db.asUser(f.repA, () => db.sql(
      `update public.hotels set is_depot = false where id = $1 returning id`, [f.hotelA]))
    expect(touched).toEqual([])

    await db.asUser(f.admin, () => db.sql(
      `update public.hotels set is_depot = false where id = $1`, [f.hotelA]))
  })

  test('nothing stops a second depot — the flag is presentation, not routing', async () => {
    await db.asUser(f.admin, () => db.sql(
      `update public.hotels set is_depot = true where id in ($1, $2)`, [f.hotelA, f.hotelB]))
    expect(await db.sql(`select id from public.hotels where is_depot`)).toHaveLength(2)
    await db.asUser(f.admin, () => db.sql(`update public.hotels set is_depot = false`))
  })
})

describe('deleting a hotel does not strand anything', () => {
  test('a car stationed there becomes unplaced, and its decisions go with it', async () => {
    const doomed = await db.one<{ id: string }>(
      `insert into public.hotels (name) values ('Typo Hotel') returning id`)

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_car_station($1, $2)`, [f.carC, doomed.id]))
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_relocation('2026-06-12', $1, $2)`, [f.carC, doomed.id]))

    await db.asUser(f.admin, () => db.sql(`delete from public.hotels where id = $1`, [doomed.id]))

    expect(await stationOf(f.carC)).toBeNull()
    expect(await db.sql(`select * from public.car_relocations where car_id = $1`, [f.carC]))
      .toEqual([])
  })
})

describe('every write of either kind is in the audit log', () => {
  test('a station change and a relocation both land there', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_complete_relocation('2026-06-12', $1, $2)`, [f.car1, f.hotelB]))

    const entities = await db.sql<{ entity: string; action: string }>(
      `select entity, action from public.audit_log
        where entity in ('cars', 'car_relocations') order by id desc limit 2`)
    expect(entities.map((e) => e.entity).sort()).toEqual(['car_relocations', 'cars'])
  })
})
