import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, type Fixtures } from '../helpers/fixtures'

// Recycle bin (20260930120000_recycle_bin.sql): a delete lands in the bin with
// everything that cascaded with it, and a restore puts all of it back.

let db: TestDb
let f: Fixtures

type BinRow = { id: string; entity: string; entity_id: string }
const bin = () => db.asUser(f.admin, () => db.sql<BinRow>(`select * from public.admin_recycle_bin()`))
const restore = (id: string) => db.asUser(f.admin, () => db.sql(`select public.admin_restore_deleted($1)`, [id]))

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

describe('recycle bin', () => {
  test('a rep can neither read nor restore', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(`select * from public.admin_recycle_bin()`)))).toBe('IR001')
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(`select public.admin_restore_deleted(1)`)))).toBe('IR001')
  })

  test('a deleted price sheet is one entry, and comes back with its prices and dates', async () => {
    const count = `select (select count(*) from public.price_rows where period_id = $1)::int as rows,
                          (select count(*) from public.pricing_period_ranges where period_id = $1)::int as ranges`
    const before = await db.one(count, [f.peak])

    await db.asUser(f.admin, () => db.sql(`delete from public.pricing_periods where id = $1`, [f.peak]))
    const entries = (await bin()).filter((e) => e.entity.startsWith('pricing'))
    expect(entries.map((e) => [e.entity, e.entity_id])).toEqual([['pricing_periods', f.peak]])

    await restore(entries[0]!.id)
    expect(await db.one(count, [f.peak])).toEqual(before)
    expect((await bin()).some((e) => e.entity_id === f.peak)).toBe(false)
    expect(await errcode(() => restore(entries[0]!.id))).toBe('IR112')
  })

  test('a deleted hotel comes back with its reps and the cars based there', async () => {
    await db.sql(`update public.cars set stationed_at = $1 where id = $2`, [f.hotelB, f.car1])
    const reps = await db.sql(`select profile_id from public.hotel_reps where hotel_id = $1 order by 1`, [f.hotelB])

    await db.asUser(f.admin, () => db.sql(`delete from public.hotels where id = $1`, [f.hotelB]))
    const entry = (await bin()).find((e) => e.entity_id === f.hotelB)!
    await restore(entry.id)

    expect(await db.sql(`select profile_id from public.hotel_reps where hotel_id = $1 order by 1`, [f.hotelB])).toEqual(reps)
    expect(await db.one(`select stationed_at from public.cars where id = $1`, [f.car1])).toEqual({ stationed_at: f.hotelB })
  })

  test('a deleted block comes back', async () => {
    const { id } = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `select public.admin_create_block($1, '2027-02-10', '2027-02-15', 'service') as id`, [f.car2]))
    await db.asUser(f.admin, () => db.sql(`select public.admin_delete_block($1)`, [id]))

    await restore((await bin()).find((e) => e.entity_id === id)!.id)
    expect(await db.one(`select block_reason from public.bookings where id = $1`, [id])).toEqual({ block_reason: 'service' })
  })
})
