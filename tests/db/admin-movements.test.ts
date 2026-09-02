import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// A1 · Movements sheet, A2 · Fleet, A5 · Bookings — all three are
// read-heavy screens over data that already exists (bookings, cars, hotels),
// with no new RLS policy and no new engine logic (HANDOFF.md). What is under
// test here is that the plain `select` these screens run sees every hotel's
// business only for an admin session, and that a rep session run against the
// exact same queries stays exactly as narrow as R6/R7 already require —
// following the shape of admin-fleet.test.ts and admin-pricing.test.ts.

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

describe('A1 · movements sheet — the query an admin runs sees every hotel', () => {
  test('a pickup at Hotel Alpha and a return at Hotel Beta both come back for the admin', async () => {
    const pickupToday = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-09',
      first: 'Pickup', last: 'Today',
    })
    const returningToday = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-03', end: '2026-07-06',
      first: 'Return', last: 'Today',
    })
    await db.sql(
      `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob,
         licence_number, licence_country, licence_issued_on, licence_expires_on)
       values ($1, true, 'A', 'B', '1985-01-01', 'X', 'GB', '2010-01-01', '2030-01-01')`,
      [returningToday])
    await db.asUser(f.repB, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [returningToday]))

    const pickups = await db.asUser(f.admin, () => db.sql<{ id: string }>(
      `select id from public.bookings
       where kind = 'rental' and start_date = '2026-07-06' and status in ('booked','out')`))
    expect(pickups.map((r) => r.id)).toContain(pickupToday)

    const returns = await db.asUser(f.admin, () => db.sql<{ id: string }>(
      `select id from public.bookings
       where kind = 'rental' and end_date = '2026-07-06' and status in ('out','returned')`))
    expect(returns.map((r) => r.id)).toContain(returningToday)
  })

  test('the same query run as a rep sees only their own and their hotel\'s movements', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-09', first: 'Alpha', last: 'Guest',
    })
    await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-09', first: 'Beta', last: 'Guest',
    })

    const seenByRepA = await db.asUser(f.repA, () => db.sql<{ cust_first: string }>(
      `select cust_first from public.bookings where kind = 'rental' and start_date = '2026-07-06'`))
    expect(seenByRepA.map((r) => r.cust_first)).toEqual(['Alpha'])
  })
})

describe('A2 · fleet — today\'s status per car', () => {
  test('an admin block is visible with its car and dates, exactly as A3 already allows', async () => {
    const block = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `select public.admin_create_block($1, '2026-07-01', '2026-12-31', 'write-off') as id`, [f.car2]))

    const [holdOnCar2] = await db.asUser(f.admin, () => db.sql<{ kind: string; car_id: string }>(
      `select kind, car_id from public.bookings where id = $1`, [block.id]))
    expect(holdOnCar2?.kind).toBe('block')
    expect(holdOnCar2?.car_id).toBe(f.car2)
  })

  test('a rep querying the same shape gets no block_reason column at all', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_create_block($1, '2026-07-01', '2026-12-31', 'write-off') as id`, [f.car2]))

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select id, block_reason from public.bookings where car_id = $1`, [f.car2])))).toBe('42501')

    // But the car still shows up as occupied through availability() — a rep's
    // own path to the fleet board's information, indistinguishable from a
    // real booking (docs/01-DECISIONS.md §8).
    const avail = await db.asUser(f.repA, () => db.one<{ occupied_dates: string[] }>(
      `select occupied_dates from public.availability('2026-07-01', '2026-07-02') where car_id = $1`,
      [f.car2]))
    expect(avail.occupied_dates).toContain('2026-07-01')
  })
})

describe('A5 · bookings — full search and full edit rights for the admin', () => {
  test('the admin can read every hotel\'s bookings in one query', async () => {
    await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    await bookAsRep(db, f.repB, { carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08' })

    const all = await db.asUser(f.admin, () => db.sql<{ id: string }>(
      `select id from public.bookings where kind = 'rental'`))
    expect(all.length).toBe(2)
  })

  test('a rep running the same query sees only what R6 already allows', async () => {
    await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    await bookAsRep(db, f.repB, { carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08' })

    const seenByRepA = await db.asUser(f.repA, () => db.sql<{ id: string }>(
      `select id from public.bookings where kind = 'rental'`))
    expect(seenByRepA.length).toBe(1)
  })

  test('the admin can edit any field on any booking at any stage, including after pickup', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await db.sql(
      `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob,
         licence_number, licence_country, licence_issued_on, licence_expires_on)
       values ($1, true, 'A', 'B', '1985-01-01', 'X', 'GB', '2010-01-01', '2030-01-01')`,
      [bookingId])
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [bookingId]))

    // A rep cannot touch the guest name once out (IR108/IR109 territory per
    // rep-booking-screens.test.ts); the admin can, at any stage.
    await db.asUser(f.admin, () => db.sql(
      `update public.bookings set cust_first = 'Changed', room_number = '999' where id = $1`,
      [bookingId]))

    const after = await db.one<{ cust_first: string; room_number: string }>(
      `select cust_first, room_number from public.bookings where id = $1`, [bookingId])
    expect(after.cust_first).toBe('Changed')
    expect(after.room_number).toBe('999')
  })

  test('admin_set_booking_price is the only way the total changes, and it is audited', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const before = await db.one<{ total: number }>(
      `select total from public.bookings where id = $1`, [bookingId])
    expect(before.total).toBe(90)

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_booking_price($1, 123)`, [bookingId]))

    const after = await db.one<{ total: number }>(
      `select total from public.bookings where id = $1`, [bookingId])
    expect(after.total).toBe(123)

    const [log] = await db.asUser(f.admin, () => db.sql<{ action: string; before: { total: number }; after: { total: number } }>(
      `select action, before, after from public.audit_log
       where entity = 'bookings' and entity_id = $1 and action = 'update'
       order by at desc limit 1`, [bookingId]))
    expect(log?.before?.total).toBe(90)
    expect(log?.after?.total).toBe(123)
  })

  test('a rep cannot reach total directly, insert or update, even on their own booking', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set total = 1 where id = $1`, [bookingId])))).toBe('42501')
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.admin_set_booking_price($1, 1)`, [bookingId])))).toBe('IR001')
  })
})
