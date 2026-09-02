import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

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

type Quote = { days: number; period_id: string; total: number }

async function quote(categoryId: string, start: string, end: string, as = f.repA): Promise<Quote> {
  return db.asUser(as, () => db.one<Quote>(
    `select days, period_id, total from public.quote($1, $2, $3)`,
    [categoryId, start, end]))
}

// The totals the fixture admin typed, for reference. The engine must return
// these numbers unchanged for 1–7 days: the +€5 first-day premium is already
// inside them and the app adds nothing of its own.
const LOW = {
  A: [35, 65, 90, 115, 140, 160, 180], extraA: 25,
  B: [40, 75, 105, 135, 165, 190, 215],
  C: [60, 115, 165, 210, 255, 295, 335],
}
const PEAK = {
  A: [55, 105, 150, 190, 230, 265, 300], extraA: 40,
  B: [65, 125, 180, 230, 280, 325, 365],
  C: [90, 175, 255, 325, 395, 455, 515],
}

describe('1 to 7 days is the total the admin typed', () => {
  for (let days = 1; days <= 7; days++) {
    test(`${days} day(s) in the low period, every category`, async () => {
      const start = '2026-07-06'
      const end = addDays(start, days - 1)
      expect(await quote(f.catA, start, end)).toMatchObject(
        { days, total: LOW.A[days - 1] })
      expect(await quote(f.catB, start, end)).toMatchObject(
        { days, total: LOW.B[days - 1] })
      expect(await quote(f.catC, start, end)).toMatchObject(
        { days, total: LOW.C[days - 1] })
    })

    test(`${days} day(s) in the peak period, every category`, async () => {
      const start = '2026-08-10'
      const end = addDays(start, days - 1)
      expect(await quote(f.catA, start, end)).toMatchObject(
        { days, total: PEAK.A[days - 1] })
      expect(await quote(f.catB, start, end)).toMatchObject(
        { days, total: PEAK.B[days - 1] })
      expect(await quote(f.catC, start, end)).toMatchObject(
        { days, total: PEAK.C[days - 1] })
    })
  }
})

describe('8 days and beyond', () => {
  test.each([
    [8,  LOW.A[6]! + 1 * LOW.extraA],
    [14, LOW.A[6]! + 7 * LOW.extraA],
    [30, LOW.A[6]! + 23 * LOW.extraA],
  ])('%i days is the 7-day total plus the extra-day rate', async (days, expected) => {
    const start = '2026-06-02'
    const q = await quote(f.catA, start, addDays(start, days - 1))
    expect(q.days).toBe(days)
    expect(q.total).toBe(expected)
  })

  test('the extra-day rate is the period the rental started in', async () => {
    // 10 days from 25 Jul: starts in Low, ends in Peak. Low prices throughout.
    const q = await quote(f.catA, '2026-07-25', '2026-08-03')
    expect(q.days).toBe(10)
    expect(q.total).toBe(LOW.A[6]! + 3 * LOW.extraA)
    expect(q.period_id).toBe(f.low)
  })
})

describe('crossing a period boundary', () => {
  test('the pickup date prices the whole rental, even into a dearer period', async () => {
    const q = await quote(f.catA, '2026-07-29', '2026-08-02')
    expect(q.days).toBe(5)
    expect(q.period_id).toBe(f.low)
    expect(q.total).toBe(LOW.A[4])          // low, not peak
    expect(q.total).not.toBe(PEAK.A[4])
  })

  test('and equally into a cheaper one', async () => {
    const q = await quote(f.catA, '2026-09-29', '2026-10-03')
    expect(q.days).toBe(5)
    expect(q.period_id).toBe(f.peak)
    expect(q.total).toBe(PEAK.A[4])
  })
})

describe('quoting fails loudly rather than guessing', () => {
  test('a pickup date in no defined period', async () => {
    expect(await errcode(() => quote(f.catA, '2026-05-01', '2026-05-03'))).toBe('IR100')
  })

  test('a pickup date covered by two periods', async () => {
    // Two seasons defined over the same dates is a data error, not a choice to
    // make on the customer's behalf.
    await db.sql(
      `insert into public.pricing_periods (season_year, name, start_date, end_date)
       values (2027, 'Overlapping', '2026-07-01', '2026-07-31')`)
    expect(await errcode(() => quote(f.catA, '2026-07-06', '2026-07-08'))).toBe('IR101')
    await db.sql(`delete from public.pricing_periods where season_year = 2027`)
  })

  test('a duration with no price row', async () => {
    await db.sql(
      `delete from public.price_rows where period_id = $1 and category_id = $2 and days = 3`,
      [f.low, f.catB])
    expect(await errcode(() => quote(f.catB, '2026-07-06', '2026-07-08'))).toBe('IR102')
    await db.sql(
      `insert into public.price_rows (period_id, category_id, days, total)
       values ($1, $2, 3, $3)`, [f.low, f.catB, LOW.B[2]])
  })

  test('8+ days with no extra-day rate', async () => {
    await db.sql(
      `delete from public.price_extra_day where period_id = $1 and category_id = $2`,
      [f.low, f.catC])
    expect(await errcode(() => quote(f.catC, '2026-07-06', '2026-07-16'))).toBe('IR103')
    await db.sql(
      `insert into public.price_extra_day (period_id, category_id, price) values ($1, $2, 45)`,
      [f.low, f.catC])
  })

  test('an unknown category, and a range that ends before it starts', async () => {
    expect(await errcode(() => quote(
      '00000000-0000-0000-0000-000000000000', '2026-07-06', '2026-07-08'))).toBe('IR106')
    expect(await errcode(() => quote(f.catA, '2026-07-08', '2026-07-06'))).toBe('IR104')
  })
})

describe('the price on a booking', () => {
  test('is the server\'s, is stored with the period that produced it, and is a whole euro integer', async () => {
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const row = await db.one<{ total: number; period_id: string; days: number; category_id: string }>(
      `select total, period_id, days, category_id from public.bookings where id = $1`, [id])

    expect(row).toMatchObject({
      total: LOW.A[2], period_id: f.low, days: 3, category_id: f.catA,
    })
    expect(Number.isInteger(row.total)).toBe(true)
  })

  test('editing the price table afterwards does not rewrite it', async () => {
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })

    await db.asUser(f.admin, () => db.sql(
      `update public.price_rows set total = 999
        where period_id = $1 and category_id = $2 and days = 3`, [f.low, f.catA]))

    const row = await db.one<{ total: number }>(
      `select total from public.bookings where id = $1`, [id])
    expect(row.total).toBe(LOW.A[2])

    await db.sql(
      `update public.price_rows set total = $3
        where period_id = $1 and category_id = $2 and days = 3`, [f.low, f.catA, LOW.A[2]])
  })

  test('baby seats and additional drivers add nothing', async () => {
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const before = await db.one<{ total: number }>(
      `select total from public.bookings where id = $1`, [id])

    await db.asUser(f.repA, async () => {
      await db.sql(
        `insert into public.booking_extras (booking_id, seat, qty) values ($1, 'infant', 1)`, [id])
      await db.sql(
        `insert into public.booking_extras (booking_id, seat, qty) values ($1, 'booster', 2)`, [id])
      await db.sql(
        `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob)
         values ($1, false, 'Second', 'Driver', '1988-03-03')`, [id])
    })

    const after = await db.one<{ total: number }>(
      `select total from public.bookings where id = $1`, [id])
    expect(after.total).toBe(before.total)
  })

  test('changing the dates before pickup re-prices the booking', async () => {
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10' where id = $1`, [id]))

    const row = await db.one<{ total: number; days: number }>(
      `select total, days from public.bookings where id = $1`, [id])
    expect(row).toMatchObject({ days: 5, total: LOW.A[4] })
  })

  test('an extension re-prices from the original pickup date\'s period', async () => {
    // Picked up 29 Jul in Low, extended to 5 Aug which is deep in Peak. The
    // rental is still priced by Low, because that is where it started.
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-29', end: '2026-08-01',
    })
    await addDriver(id)
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [id]))
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-08-05' where id = $1`, [id]))

    const row = await db.one<{ total: number; days: number; period_id: string }>(
      `select total, days, period_id from public.bookings where id = $1`, [id])
    expect(row).toMatchObject({ days: 8, period_id: f.low })
    expect(row.total).toBe(LOW.A[6]! + 1 * LOW.extraA)
  })

  test('a booking whose pickup date has no price cannot be created at all', async () => {
    expect(await errcode(() => bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-05-01', end: '2026-05-03',
    }))).toBe('IR100')
  })
})

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function addDriver(bookingId: string): Promise<void> {
  await db.sql(
    `insert into public.booking_drivers
       (booking_id, is_main, first_name, last_name, dob,
        licence_number, licence_country, licence_issued_on, licence_expires_on)
     values ($1, true, 'Anna', 'Visitor', '1985-04-02', 'X1', 'GB', '2010-05-01', '2030-05-01')`,
    [bookingId])
}
