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
        `insert into public.pricing_periods (season_year, name) values (2026, 'Mine')`))).toBe('42501')
      expect(await errcode(() => db.sql(
        `insert into public.pricing_period_ranges (period_id, start_date, end_date)
         values ($1, '2026-10-01', '2026-10-31')`, [f.low]))).toBe('42501')
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
      `insert into public.pricing_periods (season_year, name) values (2027, 'Test season') returning id`))
    await db.asUser(f.admin, () => db.sql(
      `insert into public.pricing_period_ranges (period_id, start_date, end_date)
       values ($1, '2027-06-01', '2027-06-30')`, [period.id]))

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

  test('two sheets cannot cover the same date, whatever season they are filed under', async () => {
    for (const season of [2026, 2027]) {
      const sheet = await db.asUser(f.admin, () => db.one<{ id: string }>(
        `insert into public.pricing_periods (season_year, name) values ($1, 'Clashes with Peak') returning id`,
        [season]))
      expect(await errcode(() => db.asUser(f.admin, () => db.sql(
        `insert into public.pricing_period_ranges (period_id, start_date, end_date)
         values ($1, '2026-08-15', '2026-09-15')`, [sheet.id])))).toBe('23P01')
    }
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

describe('price sheets: undated drafts and whole-sheet adjustment', () => {
  test('a sheet with no dates is a draft: it prices nothing', async () => {
    const draft = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `insert into public.pricing_periods (season_year, name) values (2026, 'Draft') returning id`))
    await db.asUser(f.admin, () => db.sql(
      `insert into public.price_rows (period_id, category_id, days, total) values ($1, $2, 1, 999)`,
      [draft.id, f.catA]))

    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select * from public.quote($1, '2029-05-10', '2029-05-10')`, [f.catA])))).toBe('IR100')
  })

  test('one sheet, two separate stretches: both price from the same numbers', async () => {
    const sheet = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `insert into public.pricing_periods (season_year, name) values (2029, 'Shoulder') returning id`))
    await db.asUser(f.admin, () => db.sql(
      `insert into public.pricing_period_ranges (period_id, start_date, end_date)
       values ($1, '2029-05-01', '2029-05-31'), ($1, '2029-10-01', '2029-10-31')`, [sheet.id]))
    await db.asUser(f.admin, () => db.sql(
      `insert into public.price_rows (period_id, category_id, days, total) values ($1, $2, 1, 60)`,
      [sheet.id, f.catA]))

    for (const day of ['2029-05-10', '2029-10-10']) {
      const q = await db.asUser(f.admin, () => db.one<{ total: number; period_id: string }>(
        `select total, period_id from public.quote($1, $2, $2)`, [f.catA, day]))
      expect(q).toEqual({ total: 60, period_id: sheet.id })
    }
  })

  test('+5 moves every total and extra-day rate on one sheet, and no other sheet', async () => {
    const snapshot = (period: string) => db.sql<{ n: number }>(
      `select total as n from public.price_rows where period_id = $1
       union all select price from public.price_extra_day where period_id = $1
       order by 1`, [period])
    const low = await snapshot(f.low)
    const peak = await snapshot(f.peak)

    await db.asUser(f.admin, () => db.sql(`select public.adjust_period_prices($1, 5)`, [f.low]))

    expect(await snapshot(f.low)).toEqual(low.map((r) => ({ n: r.n + 5 })))
    expect(await snapshot(f.peak)).toEqual(peak)

    await db.asUser(f.admin, () => db.sql(`select public.adjust_period_prices($1, -5)`, [f.low]))
    expect(await snapshot(f.low)).toEqual(low)
  })

  test('going below zero refuses the whole sheet, and a rep cannot adjust at all', async () => {
    const low = await db.sql(`select total from public.price_rows where period_id = $1 order by 1`, [f.low])
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select public.adjust_period_prices($1, -100000)`, [f.low])))).toBe('IR104')
    expect(await db.sql(`select total from public.price_rows where period_id = $1 order by 1`, [f.low])).toEqual(low)

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.adjust_period_prices($1, 5)`, [f.low])))).not.toBeNull()
  })
})
