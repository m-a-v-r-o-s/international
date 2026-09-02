import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// R5 · Return flow. The writes src/app/(app)/bookings/[id]/return drives, from
// a rep session, against the real policies and guard triggers.
//
// Two rules carry the weight here and both are checked from the rep's side,
// not the service role's: a fuel shortfall and new damage are RECORDED and
// FLAGGED and never priced (docs/01-DECISIONS.md §14) — charge and
// resolution are outside the rep's column grant entirely — and an early return
// reopens the remaining dates immediately while the price stays put (§4).

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

  test('a shortfall raises a fuel_short exception and never a charge', async () => {
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    await fuelIn(f.repA, bookingId, 6)

    await db.asUser(f.repA, () => db.sql(
      `insert into public.exceptions (booking_id, type, detail, raised_by)
       values ($1, 'fuel_short', '8/8 → 6/8 (−2/8 ≈ 9.5 L)', $2)`, [bookingId, f.repA]))

    const [raised] = await db.asUser(f.repA, () => db.sql<{ type: string; detail: string; raised_by: string }>(
      `select type, detail, raised_by from public.exceptions where booking_id = $1`, [bookingId]))
    expect(raised?.type).toBe('fuel_short')
    expect(raised?.detail).toContain('−2/8')
    expect(raised?.raised_by).toBe(f.repA)

    // The one thing the rep must never do with it.
    const [row] = await db.sql<{ charge: number | null; resolution: string | null }>(
      `select charge, resolution from public.exceptions where booking_id = $1`, [bookingId])
    expect(row?.charge).toBeNull()
    expect(row?.resolution).toBeNull()
  })

  test('a rep cannot set charge or resolution — they are not in the grant at all', async () => {
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.exceptions (booking_id, type, raised_by, charge)
       values ($1, 'fuel_short', $2, 50)`, [bookingId, f.repA])))).toBe('42501')

    await db.asUser(f.repA, () => db.sql(
      `insert into public.exceptions (booking_id, type, raised_by)
       values ($1, 'fuel_short', $2)`, [bookingId, f.repA]))

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.exceptions set charge = 50 where booking_id = $1`, [bookingId]))))
      .toBe('42501')
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select charge from public.exceptions where booking_id = $1`, [bookingId]))))
      .toBe('42501')
  })

  test('a rep cannot raise an exception in someone else\'s name, nor on their booking', async () => {
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    const other = await rentalOut(f.repB, f.car3, f.hotelB, '2026-07-06', '2026-07-08')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.exceptions (booking_id, type, raised_by)
       values ($1, 'fuel_short', $2)`, [bookingId, f.repB])))).toBe('42501')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.exceptions (booking_id, type, raised_by)
       values ($1, 'new_damage', $2)`, [other.bookingId, f.repA])))).toBe('42501')
  })

  test('a rep cannot read an exception raised on another rep\'s booking', async () => {
    const other = await rentalOut(f.repB, f.car3, f.hotelB, '2026-07-06', '2026-07-08')
    await db.asUser(f.repB, () => db.sql(
      `insert into public.exceptions (booking_id, type, raised_by)
       values ($1, 'fuel_short', $2)`, [other.bookingId, f.repB]))

    const seen = await db.asUser(f.repA, () => db.sql(
      `select id from public.exceptions where booking_id = $1`, [other.bookingId]))
    expect(seen).toHaveLength(0)
  })
})

describe('R5 step 2 · pre-existing marks carry forward, new marks are distinguished', () => {
  test('pickup marks stay pre_existing; return marks do not', async () => {
    const { bookingId, pickupId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    await db.asUser(f.repA, () => db.sql(
      `insert into public.damage_marks (handover_id, car_id, view, x, y, mark_type, pre_existing)
       values ($1, $2, 'left', 0.3, 0.5, 'scratch', true)`, [pickupId, f.car1]))

    const ret = await fuelIn(f.repA, bookingId, 8)
    await db.asUser(f.repA, () => db.sql(
      `insert into public.damage_marks (handover_id, car_id, view, x, y, mark_type, pre_existing)
       values ($1, $2, 'rear', 0.6, 0.7, 'dent', false)`, [ret.id, f.car1]))

    const marks = await db.asUser(f.repA, () => db.sql<{ view: string; pre_existing: boolean }>(
      `select m.view, m.pre_existing
       from public.damage_marks m
       join public.handovers h on h.id = m.handover_id
       where h.booking_id = $1
       order by m.pre_existing desc`, [bookingId]))

    expect(marks).toHaveLength(2)
    expect(marks[0]).toMatchObject({ view: 'left', pre_existing: true })
    expect(marks[1]).toMatchObject({ view: 'rear', pre_existing: false })
  })

  test('a mark added at return raises new_damage, and it is never priced by the rep', async () => {
    const { bookingId } = await rentalOut(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    const ret = await fuelIn(f.repA, bookingId, 8)
    await db.asUser(f.repA, () => db.sql(
      `insert into public.damage_marks (handover_id, car_id, view, x, y, mark_type, pre_existing)
       values ($1, $2, 'rear', 0.6, 0.7, 'dent', false)`, [ret.id, f.car1]))

    await db.asUser(f.repA, () => db.sql(
      `insert into public.exceptions (booking_id, type, detail, raised_by)
       values ($1, 'new_damage', '1: rear/dent', $2)`, [bookingId, f.repA]))

    const [raised] = await db.asUser(f.repA, () => db.sql<{ type: string; resolved_at: string | null }>(
      `select type, resolved_at from public.exceptions where booking_id = $1`, [bookingId]))
    expect(raised?.type).toBe('new_damage')
    expect(raised?.resolved_at).toBeNull()   // open until the boss closes it
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
