import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, type Fixtures } from '../helpers/fixtures'

// staff_hotels() — added while building R3 (New booking). docs/03-SECURITY.md
// explicitly allows a rep to "Create a booking (any hotel)", which needs the
// full hotel list to pick from, not just the hotels a rep covers (the
// `hotels_select` policy). This function is the narrow, availability()-shaped
// way to give them that list without loosening the table policy itself.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

describe('staff_hotels()', () => {
  test('a rep sees every active hotel, not only the ones they cover', async () => {
    // Rep B is stationed at Hotel Beta only, per the fixture.
    const rows = await db.asUser(f.repB, () => db.sql<{ id: string; name: string }>(
      `select id, name from public.staff_hotels()`))
    const ids = rows.map((r) => r.id).sort()
    expect(ids).toEqual([f.hotelA, f.hotelB].sort())

    // Confirms the gap this closes: the underlying table stays restricted.
    const direct = await db.asUser(f.repB, () => db.sql<{ id: string }>(
      `select id from public.hotels`))
    expect(direct.map((r) => r.id)).toEqual([f.hotelB])
  })

  test('the admin sees every active hotel too', async () => {
    const rows = await db.asUser(f.admin, () => db.sql<{ id: string }>(
      `select id from public.staff_hotels()`))
    expect(rows.map((r) => r.id).sort()).toEqual([f.hotelA, f.hotelB].sort())
  })

  test('an inactive hotel is left out', async () => {
    const inactive = await db.one<{ id: string }>(
      `insert into public.hotels (name, active) values ('Closed for the season', false) returning id`)

    const rows = await db.asUser(f.repA, () => db.sql<{ id: string }>(
      `select id from public.staff_hotels()`))
    expect(rows.map((r) => r.id)).not.toContain(inactive.id)
  })

  test('an inactive rep is refused', async () => {
    expect(await errcode(() => db.asUser(f.inactive, () => db.sql(
      `select * from public.staff_hotels()`)))).toBe('IR001')
  })

  test('anon is refused outright', async () => {
    expect(await errcode(() => db.as({ kind: 'anon' }, () => db.sql(
      `select * from public.staff_hotels()`)))).toBe('42501')
  })
})

describe('rental_days()', () => {
  test('Monday pickup, Wednesday return, is 3 days — the inclusive rule', async () => {
    const row = await db.asUser(f.repA, () => db.one<{ n: number }>(
      `select public.rental_days('2026-07-06', '2026-07-08') as n`))
    expect(row.n).toBe(3)
  })

  test('a single-day rental is 1 day, not 0', async () => {
    const row = await db.asUser(f.repA, () => db.one<{ n: number }>(
      `select public.rental_days('2026-07-06', '2026-07-06') as n`))
    expect(row.n).toBe(1)
  })

  test('an end date before the start date is rejected, not negative', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.rental_days('2026-07-08', '2026-07-06')`)))).toBe('IR104')
  })

  test('anon is refused', async () => {
    expect(await errcode(() => db.as({ kind: 'anon' }, () => db.sql(
      `select public.rental_days('2026-07-06', '2026-07-08')`)))).toBe('42501')
  })
})
