import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// A6 · Exceptions queue. The same read-heavy-screen-over-existing-schema shape
// as A1/A2/A5 — no new policy, no new engine logic — so what is under test is
// the boundary the screen sits on: an admin can see every rep's items and the
// amounts, a rep can see neither the amounts nor another rep's items, and the
// only door to charge and resolution is admin_resolve_exception().

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

async function raise(rep: string, bookingId: string, type: string, detail: string | null = null) {
  return db.asUser(rep, () => db.one<{ id: string }>(
    `insert into public.exceptions (booking_id, type, detail, raised_by)
     values ($1, $2::public.exception_type, $3, $4)
     returning id`, [bookingId, type, detail, rep]))
}

describe('A6 · the list the screen runs', () => {
  test('the admin sees every rep\'s items, across every hotel', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    const b = await bookAsRep(db, f.repB, { carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08' })
    await raise(f.repA, a, 'fuel_short', '8/8 → 6/8 (−2/8)')
    await raise(f.repB, b, 'new_damage', '1: rear/dent')

    const rows = await db.asUser(f.admin, () => db.sql<{ type: string }>(
      `select id, booking_id, type, detail, raised_by, raised_at, resolved_at
       from public.exceptions order by raised_at`))
    expect(rows.map((r) => r.type).sort()).toEqual(['fuel_short', 'new_damage'])
  })

  test('a rep running the same query sees only their own booking\'s items', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    const b = await bookAsRep(db, f.repB, { carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08' })
    await raise(f.repA, a, 'fuel_short')
    await raise(f.repB, b, 'new_damage')

    const seen = await db.asUser(f.repA, () => db.sql<{ type: string }>(
      `select id, booking_id, type, detail, raised_by, raised_at, resolved_at from public.exceptions`))
    expect(seen.map((r) => r.type)).toEqual(['fuel_short'])
  })

  test('`select *` is refused even for the admin — charge is in no client grant', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    await raise(f.repA, a, 'fuel_short')

    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select * from public.exceptions`)))).toBe('42501')
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select charge from public.exceptions`)))).toBe('42501')
  })

  test('the open/closed filter the screen applies is resolved_at, which IS granted', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    const open = await raise(f.repA, a, 'fuel_short')
    const closing = await raise(f.repA, a, 'new_damage')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_exception($1, 40, 'billed to the card on file')`, [closing.id]))

    const stillOpen = await db.asUser(f.admin, () => db.sql<{ id: string }>(
      `select id from public.exceptions where resolved_at is null`))
    expect(stillOpen.map((r) => r.id)).toEqual([open.id])
  })
})

describe('A6 · opening one item', () => {
  test('admin_exception_detail hands the admin the charge and the resolution', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    const raised = await raise(f.repA, a, 'fuel_short', '8/8 → 6/8 (−2/8 ≈ 9.5 L)')

    const before = await db.asUser(f.admin, () => db.one<{
      type: string; detail: string; charge: number | null; resolution: string | null
    }>(`select type, detail, charge, resolution from public.admin_exception_detail($1)`, [raised.id]))
    expect(before.type).toBe('fuel_short')
    expect(before.detail).toContain('−2/8')
    expect(before.charge).toBeNull()
  })

  test('a rep calling admin_exception_detail is refused (IR001)', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    const raised = await raise(f.repA, a, 'fuel_short')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select * from public.admin_exception_detail($1)`, [raised.id])))).toBe('IR001')
  })
})

describe('A6 · setting the charge and closing the item', () => {
  test('admin_resolve_exception sets the amount, the resolution and who closed it', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    const raised = await raise(f.repA, a, 'new_damage', '1: rear/dent')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_exception($1, 120, 'panel respray, quoted at the garage')`,
      [raised.id]))

    const after = await db.one<{
      charge: number; resolution: string; resolved_by: string; resolved_at: string | null
    }>(`select charge, resolution, resolved_by, resolved_at
        from public.exceptions where id = $1`, [raised.id])
    expect(after.charge).toBe(120)
    expect(after.resolution).toBe('panel respray, quoted at the garage')
    expect(after.resolved_by).toBe(f.admin)
    expect(after.resolved_at).not.toBeNull()
  })

  test('a blank amount is null, not zero — "nothing to charge" is a real answer', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    const raised = await raise(f.repA, a, 'fuel_short')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_exception($1, null, 'let it go, regular guest')`, [raised.id]))

    const after = await db.one<{ charge: number | null; resolved_at: string | null }>(
      `select charge, resolved_at from public.exceptions where id = $1`, [raised.id])
    expect(after.charge).toBeNull()
    expect(after.resolved_at).not.toBeNull()   // closed all the same
  })

  test('a negative charge is refused (IR104), not stored', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    const raised = await raise(f.repA, a, 'fuel_short')

    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_exception($1, -1, 'oops')`, [raised.id])))).toBe('IR104')
  })

  test('a rep cannot resolve anything, including their own item (IR001)', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    const raised = await raise(f.repA, a, 'fuel_short')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.admin_resolve_exception($1, 50, 'I settled it')`, [raised.id])))).toBe('IR001')

    // And the resolved item stays invisible to them field-by-field afterwards.
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_exception($1, 50, 'settled')`, [raised.id]))
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select resolution from public.exceptions where id = $1`, [raised.id])))).toBe('42501')
  })

  test('closing an item is audit-logged with actor, before and after', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    const raised = await raise(f.repA, a, 'new_damage')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_exception($1, 75, 'bumper')`, [raised.id]))

    const [log] = await db.asUser(f.admin, () => db.sql<{
      actor_id: string; before: { charge: number | null }; after: { charge: number | null }
    }>(`select actor_id, before, after from public.audit_log
        where entity = 'exceptions' and entity_id = $1 and action = 'update'
        order by at desc limit 1`, [raised.id]))
    expect(log?.actor_id).toBe(f.admin)
    expect(log?.before?.charge).toBeNull()
    expect(log?.after?.charge).toBe(75)
  })

  test('a resolved item can be reopened in amount by the admin, and that is logged too', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    const raised = await raise(f.repA, a, 'new_damage')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_exception($1, 75, 'bumper')`, [raised.id]))
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_exception($1, 50, 'bumper, discounted')`, [raised.id]))

    const after = await db.one<{ charge: number }>(
      `select charge from public.exceptions where id = $1`, [raised.id])
    expect(after.charge).toBe(50)

    const logs = await db.asUser(f.admin, () => db.sql(
      `select id from public.audit_log where entity = 'exceptions' and entity_id = $1 and action = 'update'`,
      [raised.id]))
    expect(logs.length).toBe(2)
  })
})

describe('A6 · everything else in the business lands here too', () => {
  test('an eligibility override raised from A5 appears on this queue', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.carC, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_override_eligibility($1, 'boss knows the guest')`, [bookingId]))

    const rows = await db.asUser(f.admin, () => db.sql<{ type: string; raised_by: string }>(
      `select type, raised_by from public.exceptions where booking_id = $1`, [bookingId]))
    expect(rows[0]?.type).toBe('eligibility_override')
    expect(rows[0]?.raised_by).toBe(f.admin)
  })

  test('late_return and no_show are the same shape, and the same queue', async () => {
    const a = await bookAsRep(db, f.repA, { carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08' })
    await raise(f.repA, a, 'late_return', 'back 2026-07-09')
    await raise(f.repA, a, 'no_show')

    const rows = await db.asUser(f.admin, () => db.sql<{ type: string }>(
      `select type from public.exceptions where booking_id = $1 order by type`, [a]))
    expect(rows.map((r) => r.type)).toEqual(['late_return', 'no_show'])
  })
})
