import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, type Fixtures } from '../helpers/fixtures'

// R2/R3/R6/R7 — the rep booking core. These exercise exactly the column sets
// the server actions in src/app/(app)/availability, src/app/(app)/bookings
// and src/app/(app)/bookings/[id] write, run from a rep session against the
// real RLS policies and guard triggers, per HANDOFF.md's instruction that
// every screen's data access gets an isolation test from a rep session.

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

describe('R3 · creating a booking with exactly the fields the form sends', () => {
  test('the fields the screen omits are still filled in correctly by the guard trigger', async () => {
    const booking = await db.asUser(f.repA, () => db.one<{
      id: string; ref: string; kind: string; status: string
      created_by: string; days: number; total: number; period_id: string
    }>(
      `insert into public.bookings
         (car_id, hotel_id, room_number, start_date, end_date,
          cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '304', '2026-07-06', '2026-07-08', 'Anna', 'Guest', '+306900000001', '1990-05-01')
       returning id, ref, kind, status, created_by, days, total, period_id`,
      [f.car1, f.hotelA]))

    expect(booking.kind).toBe('rental')
    expect(booking.status).toBe('booked')
    expect(booking.created_by).toBe(f.repA)
    expect(booking.days).toBe(3)
    expect(booking.total).toBe(90)   // fixture's 3-day low/catA total
    expect(booking.ref).toMatch(/^\d{4}-\d{4}$/)
    expect(booking.period_id).toBe(f.low)
  })

  test('the exclusion constraint refuses a double booking, surfaced as a real error', async () => {
    await db.asUser(f.repA, () => db.sql(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '2026-07-06', '2026-07-08', 'A', 'B', '+1', '1990-01-01')`,
      [f.car1, f.hotelA]))

    expect(await errcode(() => db.asUser(f.repB, () => db.sql(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '2026-07-07', '2026-07-09', 'C', 'D', '+2', '1990-01-01')`,
      [f.car1, f.hotelB])))).toBe('23P01')
  })

  test('a rep may book at a hotel that is not their own — the shared-fleet rule', async () => {
    // Rep B is stationed only at Hotel Beta; booking at Hotel Alpha must still work.
    const booking = await db.asUser(f.repB, () => db.one<{ hotel_id: string }>(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '2026-07-06', '2026-07-08', 'A', 'B', '+1', '1990-01-01')
       returning hotel_id`,
      [f.car3, f.hotelA]))
    expect(booking.hotel_id).toBe(f.hotelA)
  })

  test('extras (baby seats) attach to the booking and stay free', async () => {
    const booking = await db.asUser(f.repA, () => db.one<{ id: string }>(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '2026-07-06', '2026-07-08', 'A', 'B', '+1', '1990-01-01')
       returning id`,
      [f.car1, f.hotelA]))

    await db.asUser(f.repA, () => db.sql(
      `insert into public.booking_extras (booking_id, seat) values ($1, 'infant')`, [booking.id]))

    const priced = await db.one<{ total: number }>(
      `select total from public.bookings where id = $1`, [booking.id])
    expect(priced.total).toBe(90)   // unchanged — extras add nothing
  })
})

describe('R7 · edit and cancel before pickup', () => {
  test('the owning rep can edit their own booking before pickup', async () => {
    const booking = await db.asUser(f.repA, () => db.one<{ id: string }>(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '2026-07-06', '2026-07-08', 'A', 'B', '+1', '1990-01-01')
       returning id`,
      [f.car1, f.hotelA]))

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set room_number = '212', cust_phone = '+306900099999' where id = $1`,
      [booking.id]))

    const after = await db.one<{ room_number: string; cust_phone: string }>(
      `select room_number, cust_phone from public.bookings where id = $1`, [booking.id])
    expect(after.room_number).toBe('212')
    expect(after.cust_phone).toBe('+306900099999')
  })

  test('cancelling frees the dates immediately', async () => {
    const booking = await db.asUser(f.repA, () => db.one<{ id: string }>(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '2026-07-06', '2026-07-08', 'A', 'B', '+1', '1990-01-01')
       returning id`,
      [f.car1, f.hotelA]))

    const before = await db.asUser(f.repB, () => db.one<{ occupied_dates: string[] }>(
      `select occupied_dates from public.availability('2026-07-01', '2026-07-31') where car_id = $1`,
      [f.car1]))
    expect(before.occupied_dates).toContain('2026-07-07')

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'cancelled' where id = $1`, [booking.id]))

    const after = await db.asUser(f.repB, () => db.one<{ occupied_dates: string[] }>(
      `select occupied_dates from public.availability('2026-07-01', '2026-07-31') where car_id = $1`,
      [f.car1]))
    expect(after.occupied_dates).not.toContain('2026-07-07')
  })
})

describe('R7 · extend after pickup, with same-category swap', () => {
  async function bookAndPickUp(carId: string, hotelId: string, start: string, end: string) {
    const booking = await db.asUser(f.repA, () => db.one<{ id: string }>(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, $3, $4, 'A', 'B', '+1', '1990-01-01')
       returning id`,
      [carId, hotelId, start, end]))

    await db.sql(
      `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob,
         licence_number, licence_country, licence_issued_on, licence_expires_on)
       values ($1, true, 'A', 'B', '1985-01-01', 'X', 'GB', '2010-01-01', '2030-01-01')`,
      [booking.id])
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [booking.id]))

    return booking.id
  }

  test('extending onto free dates on the same car succeeds and re-prices from the pickup period', async () => {
    const bookingId = await bookAndPickUp(f.car1, f.hotelA, '2026-07-06', '2026-07-08')

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10' where id = $1`, [bookingId]))

    const after = await db.one<{ end_date: string; days: number; total: number }>(
      `select end_date, days, total from public.bookings where id = $1`, [bookingId])
    expect(after.end_date).toBe('2026-07-10')
    expect(after.days).toBe(5)
    expect(after.total).toBe(140)   // fixture's 5-day low/catA total
  })

  test('shortening an in-progress rental is refused (IR110), not silently clamped', async () => {
    const bookingId = await bookAndPickUp(f.car1, f.hotelA, '2026-07-06', '2026-07-10')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-08' where id = $1`, [bookingId]))))
      .toBe('IR110')
  })

  test('extending onto dates the same car is already booked for offers a same-category swap', async () => {
    const bookingId = await bookAndPickUp(f.car1, f.hotelA, '2026-07-06', '2026-07-08')

    // Someone else books car1 for the dates rep A wants to extend into.
    await db.asUser(f.repB, () => db.sql(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '2026-07-09', '2026-07-12', 'C', 'D', '+2', '1990-01-01')`,
      [f.car1, f.hotelB]))

    // car2 is the same category (catA) and is free — the swap target.
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10' where id = $1`, [bookingId]))))
      .toBe('23P01')

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10', car_id = $2 where id = $1`,
      [bookingId, f.car2]))

    const after = await db.one<{ car_id: string; end_date: string }>(
      `select car_id, end_date from public.bookings where id = $1`, [bookingId])
    expect(after.car_id).toBe(f.car2)
    expect(after.end_date).toBe('2026-07-10')
  })

  test('a swap to a car in a different category is refused (IR111)', async () => {
    const bookingId = await bookAndPickUp(f.car1, f.hotelA, '2026-07-06', '2026-07-08')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10', car_id = $2 where id = $1`,
      [bookingId, f.carC])))).toBe('IR111')
  })

  test('only extend is allowed once out — editing the guest name is refused (fields silently reverted)', async () => {
    const bookingId = await bookAndPickUp(f.car1, f.hotelA, '2026-07-06', '2026-07-08')

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set cust_first = 'Changed', end_date = '2026-07-09' where id = $1`,
      [bookingId]))

    const after = await db.one<{ cust_first: string }>(
      `select cust_first from public.bookings where id = $1`, [bookingId])
    expect(after.cust_first).toBe('A')   // reverted by the guard trigger
  })
})

describe('R6 · my bookings sees exactly the isolation rules already tested for bookings', () => {
  test('search-relevant columns (ref, names, dates) are all within what RLS already allows', async () => {
    const booking = await db.asUser(f.repA, () => db.one<{ id: string; ref: string }>(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '2026-07-06', '2026-07-08', 'Searchable', 'Guest', '+1', '1990-01-01')
       returning id, ref`,
      [f.car1, f.hotelA]))

    const seenByOwner = await db.asUser(f.repA, () => db.sql<{ id: string }>(
      `select id from public.bookings where id = $1`, [booking.id]))
    expect(seenByOwner).toHaveLength(1)

    const seenByStranger = await db.asUser(f.repB, () => db.sql<{ id: string }>(
      `select id from public.bookings where id = $1`, [booking.id]))
    expect(seenByStranger).toHaveLength(0)
  })
})
