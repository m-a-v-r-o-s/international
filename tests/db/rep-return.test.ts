import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// R5 · Return flow. The writes src/app/(app)/bookings/[id]/return drives, from
// a rep session, against the real policies and guard triggers.
//
// Two rules carry the weight here and both are checked from the rep's side,
// not the service role's: what a returning car costs is never the rep's to
// decide (docs/01-DECISIONS.md §14) — a fuel shortfall is priced by the
// database itself and `charge`/`resolution` on an incident are outside the
// rep's column grant entirely — and an early return reopens the remaining
// dates immediately while the price stays put (§4).

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.sql(`delete from public.bookings`)
})

/** A rental taken all the way to `out` the way R4 does it. */
async function rentalOut(
  rep: string, carId: string, hotelId: string, start: string, end: string, fuelOut = 8,
) {
  const bookingId = await bookAsRep(db, rep, { carId, hotelId, start, end })

  await db.asUser(rep, () => db.sql(
    `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob,
       licence_number, licence_country, licence_issued_on, licence_expires_on)
     values ($1, true, 'Anna', 'Driver', '1985-04-02', 'GR1', 'GR', '2010-06-01', '2032-06-01')`,
    [bookingId]))

  const pickup = await db.asUser(rep, () => db.one<{ id: string }>(
    `insert into public.handovers (booking_id, kind, by_profile, fuel_eighths)
     values ($1, 'pickup', $2, $3) returning id`, [bookingId, rep, fuelOut]))

  await db.asUser(rep, () => db.sql(
    `update public.bookings set status = 'out' where id = $1`, [bookingId]))

  return { bookingId, pickupId: pickup.id }
}

async function fuelIn(rep: string, bookingId: string, eighths: number) {
  return db.asUser(rep, () => db.one<{ id: string }>(
    `insert into public.handovers (booking_id, kind, by_profile, fuel_eighths)
     values ($1, 'return', $2, $3) returning id`, [bookingId, rep, eighths]))
}

describe('R5 step 1 · fuel in, and the shortfall the rep never prices', () => {
  test('the return handover sits alongside the pickup one, not in place of it', async () => {
    const { bookingId, pickupId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    const ret = await fuelIn(f.repA, bookingId, 6)

    const rows = await db.asUser(f.repA, () => db.sql<{ kind: string; fuel_eighths: number }>(
      `select kind, fuel_eighths from public.handovers where booking_id = $1 order by kind`,
      [bookingId]))
    expect(rows.map((r) => r.kind)).toEqual(['pickup', 'return'])
    expect(rows.map((r) => r.fuel_eighths)).toEqual([8, 6])
    expect(ret.id).not.toBe(pickupId)
  })

  test('a shortfall is priced by the database at the moment of return', async () => {
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    const before = await db.one<{ total: number }>(
      `select total from public.bookings where id = $1`, [bookingId])
    await fuelIn(f.repA, bookingId, 6)

    // Reading the gauge is not returning the car: nothing is charged until the
    // rental actually closes.
    expect((await db.one<{ fuel_charge: number | null }>(
      `select fuel_charge from public.bookings where id = $1`, [bookingId])).fuel_charge)
      .toBeNull()

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'returned' where id = $1`, [bookingId]))

    const after = await db.one<{ fuel_charge: number; total: number }>(
      `select fuel_charge, total from public.bookings where id = $1`, [bookingId])
    expect(after.fuel_charge).toBe(20)          // two eighths short, at €10 each
    // And it is a SEPARATE figure: the total is the one on the signed
    // agreement and does not move (0030).
    expect(after.total).toBe(before.total)
  })

  test('the rate is a setting, not a constant', async () => {
    await db.sql(`update public.app_settings set fuel_charge_per_eighth = 15 where id = 1`)
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    await fuelIn(f.repA, bookingId, 5)
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'returned' where id = $1`, [bookingId]))

    expect((await db.one<{ fuel_charge: number }>(
      `select fuel_charge from public.bookings where id = $1`, [bookingId])).fuel_charge)
      .toBe(45)                                  // three eighths × €15

    await db.sql(`update public.app_settings set fuel_charge_per_eighth = 10 where id = 1`)
  })

  test('a car brought back full, or fuller, is charged nothing at all', async () => {
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08', 6)
    await fuelIn(f.repA, bookingId, 8)
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'returned' where id = $1`, [bookingId]))

    // Null, not zero: "nothing to charge" and "charged €0" are different
    // statements about a rental.
    expect((await db.one<{ fuel_charge: number | null }>(
      `select fuel_charge from public.bookings where id = $1`, [bookingId])).fuel_charge)
      .toBeNull()
  })

  test('a rep cannot write the fuel charge, or talk the trigger out of it', async () => {
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    await fuelIn(f.repA, bookingId, 6)

    // Not in the update grant at all.
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set fuel_charge = 0 where id = $1`, [bookingId])))).toBe('42501')

    // And the owner writing it by hand is still overruled by the transition,
    // which computes the figure rather than accepting one.
    await db.sql(
      `update public.bookings set status = 'returned', fuel_charge = 0 where id = $1`,
      [bookingId])
    expect((await db.one<{ fuel_charge: number }>(
      `select fuel_charge from public.bookings where id = $1`, [bookingId])).fuel_charge)
      .toBe(20)
  })

  test('a rep cannot set charge or resolution — they are not in the grant at all', async () => {
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.incidents (booking_id, note, raised_by, charge)
       values ($1, 'scratched', $2, 50)`, [bookingId, f.repA])))).toBe('42501')

    await db.asUser(f.repA, () => db.sql(
      `insert into public.incidents (booking_id, note, raised_by)
       values ($1, 'scratched', $2)`, [bookingId, f.repA]))

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.incidents set charge = 50 where booking_id = $1`, [bookingId]))))
      .toBe('42501')
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select charge from public.incidents where booking_id = $1`, [bookingId]))))
      .toBe('42501')
  })

  test('a rep cannot raise an incident in someone else\'s name, nor on their booking', async () => {
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    const other = await rentalOut(f.repB, f.car3, f.hotelB, '2026-07-06', '2026-07-08')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.incidents (booking_id, note, raised_by)
       values ($1, 'not my name', $2)`, [bookingId, f.repB])))).toBe('42501')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.incidents (booking_id, note, raised_by)
       values ($1, 'not my booking', $2)`, [other.bookingId, f.repA])))).toBe('42501')
  })

  test('a rep cannot read an incident raised on another rep\'s booking', async () => {
    const other = await rentalOut(f.repB, f.car3, f.hotelB, '2026-07-06', '2026-07-08')
    await db.asUser(f.repB, () => db.sql(
      `insert into public.incidents (booking_id, note, raised_by)
       values ($1, 'theirs', $2)`, [other.bookingId, f.repB]))

    const seen = await db.asUser(f.repA, () => db.sql(
      `select id from public.incidents where booking_id = $1`, [other.bookingId]))
    expect(seen).toHaveLength(0)
  })
})

describe('R5 step 2 · the damage diagram belongs to the pickup', () => {
  // The return no longer has a diagram of its own (0030). Damage found on a
  // returning car is reported as an INCIDENT, in words and photographs, which
  // is how a cracked mirror is actually described. What survives here is the
  // pickup side: those marks are the car's agreed condition and go on to the
  // signed contract, so `pre_existing` still means what it always did.
  test('pickup marks are the pre-existing condition the contract is signed against', async () => {
    const { bookingId, pickupId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    await db.asUser(f.repA, () => db.sql(
      `insert into public.damage_marks (handover_id, car_id, view, x, y, mark_type, pre_existing)
       values ($1, $2, 'left', 0.3, 0.5, 'scratch', true)`, [pickupId, f.car1]))

    const marks = await db.asUser(f.repA, () => db.sql<{ view: string; pre_existing: boolean }>(
      `select m.view, m.pre_existing
       from public.damage_marks m
       join public.handovers h on h.id = m.handover_id
       where h.booking_id = $1 and h.kind = 'pickup'`, [bookingId]))

    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({ view: 'left', pre_existing: true })
  })
})

describe('R5 confirm · out → returned', () => {
  test('the transition closes the rental and stamps returned_at', async () => {
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    await fuelIn(f.repA, bookingId, 8)

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'returned' where id = $1`, [bookingId]))

    const after = await db.one<{ status: string; returned_at: string | null }>(
      `select status, returned_at from public.bookings where id = $1`, [bookingId])
    expect(after.status).toBe('returned')
    expect(after.returned_at).not.toBeNull()
  })

  test('AN EARLY RETURN REOPENS THE REMAINING DATES IMMEDIATELY, and the price does not move', async () => {
    // Booked Mon 6th → Fri 10th; brought back on the Wednesday.
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-10')

    const priceBefore = await db.one<{ total: number; days: number }>(
      `select total, days from public.bookings where id = $1`, [bookingId])

    const before = await db.asUser(f.repB, () => db.one<{ occupied_dates: string[] }>(
      `select occupied_dates from public.availability('2026-07-01', '2026-07-31') where car_id = $1`,
      [f.car1]))
    expect(before.occupied_dates).toContain('2026-07-09')
    expect(before.occupied_dates).toContain('2026-07-10')

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'returned' where id = $1`, [bookingId]))

    const after = await db.asUser(f.repB, () => db.one<{ occupied_dates: string[] }>(
      `select occupied_dates from public.availability('2026-07-01', '2026-07-31') where car_id = $1`,
      [f.car1]))
    expect(after.occupied_dates).toEqual([])

    // Early return earns no refund: the full booked duration stays charged.
    const priceAfter = await db.one<{ total: number; days: number }>(
      `select total, days from public.bookings where id = $1`, [bookingId])
    expect(priceAfter.total).toBe(priceBefore.total)
    expect(priceAfter.days).toBe(priceBefore.days)
  })

  test('the freed days can be re-let straight away, with no turnaround gap', async () => {
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-10')
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'returned' where id = $1`, [bookingId]))

    const next = await bookAsRep(db, f.repB, {
      carId: f.car1, hotelId: f.hotelB, start: '2026-07-09', end: '2026-07-12',
    })
    const row = await db.one<{ status: string }>(
      `select status from public.bookings where id = $1`, [next])
    expect(row.status).toBe('booked')
  })

  test('a returned rental is closed to the rep — no second return, no edits (IR108)', async () => {
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'returned' where id = $1`, [bookingId]))

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'returned' where id = $1`, [bookingId])))).toBe('IR108')
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set collected = 1 where id = $1`, [bookingId])))).toBe('IR108')
  })

  test('a rep cannot return another rep\'s rental', async () => {
    const other = await rentalOut(f.repB, f.car3, f.hotelB, '2026-07-06', '2026-07-08')

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'returned' where id = $1`, [other.bookingId]))

    const after = await db.one<{ status: string }>(
      `select status from public.bookings where id = $1`, [other.bookingId])
    expect(after.status).toBe('out')   // the policy matched no row; nothing happened
  })
})
