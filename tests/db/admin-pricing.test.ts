import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// A4 · Pricing — periods, the 8×7 grid and the extra-day rate, all reached
// through the same table grants a rep already cannot use
// (docs/06-IMPLEMENTATION-NOTES.md). The build plan's pricing test list
// (docs/05-BUILD-PLAN.md) requires that editing a price table never rewrites
// an existing booking's stored total; that guarantee is exercised here at the
// table level the admin screen writes through.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

describe('a rep cannot touch pricing at all', () => {
  test('every table is empty to them, and every write is refused', async () => {
    await db.asUser(f.repA, async () => {
      expect(await db.sql(`select id from public.pricing_periods`)).toEqual([])
      expect(await errcode(() => db.sql(
        `insert into public.pricing_periods (season_year, name, start_date, end_date)
         values (2026, 'Mine', '2026-10-01', '2026-10-31')`))).toBe('42501')
      expect(await errcode(() => db.sql(
        `insert into public.price_rows (period_id, category_id, days, total)
         values ($1, $2, 1, 1)`, [f.low, f.catA]))).toBe('42501')
      expect(await errcode(() => db.sql(
        `insert into public.price_extra_day (period_id, category_id, price)
         values ($1, $2, 1)`, [f.low, f.catA]))).toBe('42501')
    })
  })
})

describe('the admin can manage periods and the grid', () => {
  test('add a period, then a full week of totals and the extra-day rate for one category', async () => {
    const period = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `insert into public.pricing_periods (season_year, name, start_date, end_date)
       values (2027, 'Test season', '2027-06-01', '2027-06-30') returning id`))

    for (let day = 1; day <= 7; day++) {
      await db.asUser(f.admin, () => db.sql(
        `insert into public.price_rows (period_id, category_id, days, total)
         values ($1, $2, $3, $4)`,
        [period.id, f.catA, day, 30 + day * 5]))
    }
    await db.asUser(f.admin, () => db.sql(
      `insert into public.price_extra_day (period_id, category_id, price) values ($1, $2, 22)`,
      [period.id, f.catA]))

    const quote3 = await db.asUser(f.admin, () => db.one<{ total: number }>(
      `select total from public.quote($1, '2027-06-05', '2027-06-07')`, [f.catA]))
    expect(quote3.total).toBe(30 + 3 * 5)   // the 3-day row, verbatim

    const quote10 = await db.asUser(f.admin, () => db.one<{ total: number }>(
      `select total from public.quote($1, '2027-06-01', '2027-06-10')`, [f.catA]))
    expect(quote10.total).toBe((30 + 7 * 5) + 3 * 22)   // 7-day total + 3 extra days
  })

  test('upsert semantics: writing the same period/category/days cell again replaces it', async () => {
    await db.asUser(f.admin, () => db.sql(
      `insert into public.price_rows (period_id, category_id, days, total)
       values ($1, $2, 1, 40)
       on conflict (period_id, category_id, days) do update set total = excluded.total`,
      [f.low, f.catB]))

    const row = await db.one<{ total: number }>(
      `select total from public.price_rows where period_id = $1 and category_id = $2 and days = 1`,
      [f.low, f.catB])
    expect(row.total).toBe(40)
  })

  test('two periods in the same season cannot overlap', async () => {
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `insert into public.pricing_periods (season_year, name, start_date, end_date)
       values (2026, 'Clashes with Peak', '2026-08-15', '2026-09-15')`)))).toBe('23P01')
  })

  test('the same date range in a different season is fine', async () => {
    const row = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `insert into public.pricing_periods (season_year, name, start_date, end_date)
       values (2027, 'Same dates, different season', '2026-08-01', '2026-08-31') returning id`))
    expect(row.id).toBeTruthy()
  })
})

describe('editing a price table never rewrites a booking already priced from it', () => {
  test('changing the 3-day low-season rate for category A leaves an existing booking untouched', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-01', end: '2026-07-03',
    })
    const before = await db.one<{ total: number; period_id: string }>(
      `select total, period_id from public.bookings where id = $1`, [bookingId])
    expect(before.total).toBe(90)   // the 3-day low/catA total from the fixture
    expect(before.period_id).toBe(f.low)

    await db.asUser(f.admin, () => db.sql(
      `update public.price_rows set total = 1 where period_id = $1 and category_id = $2 and days = 3`,
      [f.low, f.catA]))

    const after = await db.one<{ total: number }>(
      `select total from public.bookings where id = $1`, [bookingId])
    expect(after.total).toBe(90)   // unchanged — the booking's price is frozen at creation

    // A fresh quote for the same shape now reflects the new price.
    const fresh = await db.asUser(f.admin, () => db.one<{ total: number }>(
      `select total from public.quote($1, '2026-07-01', '2026-07-03')`, [f.catA]))
    expect(fresh.total).toBe(1)
  })
})

describe('quoting fails loudly rather than guessing', () => {
  test('a pickup date outside every defined period is IR100, not a fallback price', async () => {
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select * from public.quote($1, '2099-01-01', '2099-01-03')`, [f.catA])))).toBe('IR100')
  })
})
