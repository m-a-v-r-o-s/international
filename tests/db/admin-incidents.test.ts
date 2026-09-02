import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// A6 · Incidents queue. The same read-heavy-screen-over-existing-schema shape
// as A1/A2/A5 — no new engine logic — so what is under test is the boundary the
// screen sits on: an admin can see every rep's items and the amounts, a rep can
// see neither the amounts nor another rep's items, and the only door to charge
// and resolution is admin_resolve_incident().
//
// The photos are the one genuinely new surface (0030) and get their own block
// at the bottom: they are a plain table with plain policies, gated on the same
// app.can_read_booking() as the incident they hang off.

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

async function raise(rep: string, bookingId: string, note: string | null = null) {
  return db.asUser(rep, () => db.one<{ id: string }>(
    `insert into public.incidents (booking_id, note, raised_by)
     values ($1, $2, $3)
     returning id`, [bookingId, note, rep]))
}

async function booking(rep: string, carId: string, hotelId: string) {
  return bookAsRep(db, rep, { carId, hotelId, start: '2026-07-06', end: '2026-07-08' })
}

describe('A6 · the list the screen runs', () => {
  test('the admin sees every rep\'s items, across every hotel', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const b = await booking(f.repB, f.car3, f.hotelB)
    await raise(f.repA, a, 'wing mirror cracked')
    await raise(f.repB, b, 'came back filthy inside')

    const rows = await db.asUser(f.admin, () => db.sql<{ note: string }>(
      `select id, booking_id, note, raised_by, raised_at, resolved_at
       from public.incidents order by raised_at`))
    expect(rows.map((r) => r.note).sort())
      .toEqual(['came back filthy inside', 'wing mirror cracked'])
  })

  test('a rep running the same query sees only their own booking\'s items', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const b = await booking(f.repB, f.car3, f.hotelB)
    await raise(f.repA, a, 'mine')
    await raise(f.repB, b, 'theirs')

    const seen = await db.asUser(f.repA, () => db.sql<{ note: string }>(
      `select id, booking_id, note, raised_by, raised_at, resolved_at from public.incidents`))
    expect(seen.map((r) => r.note)).toEqual(['mine'])
  })

  test('`select *` is refused even for the admin — charge is in no client grant', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    await raise(f.repA, a, 'scratched')

    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select * from public.incidents`)))).toBe('42501')
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select charge from public.incidents`)))).toBe('42501')
  })

  test('the open/closed filter the screen applies is resolved_at, which IS granted', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const open = await raise(f.repA, a, 'still open')
    const closing = await raise(f.repA, a, 'about to be closed')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_incident($1, 40, 'billed to the card on file')`, [closing.id]))

    const stillOpen = await db.asUser(f.admin, () => db.sql<{ id: string }>(
      `select id from public.incidents where resolved_at is null`))
    expect(stillOpen.map((r) => r.id)).toEqual([open.id])
  })
})

describe('A6 · opening one item', () => {
  test('admin_incident_detail hands the admin the charge and the resolution', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'wing mirror cracked, photo attached')

    const before = await db.asUser(f.admin, () => db.one<{
      note: string; charge: number | null; resolution: string | null
    }>(`select note, charge, resolution from public.admin_incident_detail($1)`, [raised.id]))
    expect(before.note).toContain('wing mirror')
    expect(before.charge).toBeNull()
    expect(before.resolution).toBeNull()
  })

  test('a rep calling admin_incident_detail is refused (IR001)', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'scratched')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select * from public.admin_incident_detail($1)`, [raised.id])))).toBe('IR001')
  })
})

describe('A6 · setting the charge and closing the item', () => {
  test('admin_resolve_incident sets the amount, the resolution and who closed it', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'dent in the rear panel')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_incident($1, 120, 'panel respray, quoted at the garage')`,
      [raised.id]))

    const after = await db.one<{
      charge: number; resolution: string; resolved_by: string; resolved_at: string | null
    }>(`select charge, resolution, resolved_by, resolved_at
        from public.incidents where id = $1`, [raised.id])
    expect(after.charge).toBe(120)
    expect(after.resolution).toBe('panel respray, quoted at the garage')
    expect(after.resolved_by).toBe(f.admin)
    expect(after.resolved_at).not.toBeNull()
  })

  test('a blank amount is null, not zero — "nothing to charge" is a real answer', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'scuffed alloy')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_incident($1, null, 'let it go, regular guest')`, [raised.id]))

    const after = await db.one<{ charge: number | null; resolved_at: string | null }>(
      `select charge, resolved_at from public.incidents where id = $1`, [raised.id])
    expect(after.charge).toBeNull()
    expect(after.resolved_at).not.toBeNull()   // closed all the same
  })

  test('a negative charge is refused (IR104), not stored', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'scratched')

    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_incident($1, -1, 'oops')`, [raised.id])))).toBe('IR104')
  })

  test('a rep cannot resolve anything, including their own item (IR001)', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'scratched')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.admin_resolve_incident($1, 50, 'I settled it')`, [raised.id])))).toBe('IR001')

    // And the resolved item stays invisible to them field-by-field afterwards.
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_incident($1, 50, 'settled')`, [raised.id]))
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select resolution from public.incidents where id = $1`, [raised.id])))).toBe('42501')
  })

  test('closing an item is audit-logged with actor, before and after', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'bumper')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_incident($1, 75, 'bumper')`, [raised.id]))

    const [log] = await db.asUser(f.admin, () => db.sql<{
      actor_id: string; before: { charge: number | null }; after: { charge: number | null }
    }>(`select actor_id, before, after from public.audit_log
        where entity = 'incidents' and entity_id = $1 and action = 'update'
        order by at desc limit 1`, [raised.id]))
    expect(log?.actor_id).toBe(f.admin)
    expect(log?.before?.charge).toBeNull()
    expect(log?.after?.charge).toBe(75)
  })

  test('a resolved item can be reopened in amount by the admin, and that is logged too', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'bumper')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_incident($1, 75, 'bumper')`, [raised.id]))
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_incident($1, 50, 'bumper, discounted')`, [raised.id]))

    const after = await db.one<{ charge: number }>(
      `select charge from public.incidents where id = $1`, [raised.id])
    expect(after.charge).toBe(50)

    const logs = await db.asUser(f.admin, () => db.sql(
      `select id from public.audit_log where entity = 'incidents' and entity_id = $1 and action = 'update'`,
      [raised.id]))
    expect(logs.length).toBe(2)
  })
})

describe('A6 · the photos the rep attached', () => {
  async function attach(rep: string, incidentId: string, bookingId: string, name: string) {
    return db.asUser(rep, () => db.one<{ id: string }>(
      `insert into public.incident_photos (incident_id, path, added_by)
       values ($1, $2, $3) returning id`,
      [incidentId, `${bookingId}/incidents/${name}.jpg`, rep]))
  }

  test('the rep who raised it can attach, and the boss can read them back', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'cracked mirror')
    await attach(f.repA, raised.id, a, 'one')
    await attach(f.repA, raised.id, a, 'two')

    const seen = await db.asUser(f.admin, () => db.sql<{ path: string }>(
      `select path from public.incident_photos where incident_id = $1 order by path`,
      [raised.id]))
    expect(seen.map((r) => r.path)).toEqual([`${a}/incidents/one.jpg`, `${a}/incidents/two.jpg`])
  })

  test('another rep can neither see them nor add one of their own', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'cracked mirror')
    await attach(f.repA, raised.id, a, 'one')

    await db.asUser(f.repB, async () => {
      expect(await db.sql(
        `select id, path from public.incident_photos where incident_id = $1`, [raised.id]))
        .toEqual([])
      expect(await errcode(() => db.sql(
        `insert into public.incident_photos (incident_id, path, added_by)
         values ($1, $2, $3)`, [raised.id, `${a}/incidents/theirs.jpg`, f.repB])))
        .toBe('42501')
    })
  })

  test('nothing can be added to an item the boss has already closed', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'cracked mirror')
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_incident($1, 60, 'replaced')`, [raised.id]))

    expect(await errcode(() => attach(f.repA, raised.id, a, 'late'))).toBe('42501')
  })

  test('a rep withdraws their own mis-tap, but only while the item is open', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'cracked mirror')
    const wrong = await attach(f.repA, raised.id, a, 'wrong')
    const keep = await attach(f.repA, raised.id, a, 'right')

    await db.asUser(f.repA, () => db.sql(
      `delete from public.incident_photos where id = $1`, [wrong.id]))
    expect(await db.asUser(f.repA, () => db.sql(
      `select id from public.incident_photos where incident_id = $1`, [raised.id])))
      .toHaveLength(1)

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_resolve_incident($1, 60, 'replaced')`, [raised.id]))

    // Closed: the evidence the boss ruled on stays put.
    await db.asUser(f.repA, () => db.sql(
      `delete from public.incident_photos where id = $1`, [keep.id]))
    expect(await db.asUser(f.admin, () => db.sql(
      `select id from public.incident_photos where incident_id = $1`, [raised.id])))
      .toHaveLength(1)
  })

  test('the photos go with the incident when the booking is deleted', async () => {
    const a = await booking(f.repA, f.car1, f.hotelA)
    const raised = await raise(f.repA, a, 'cracked mirror')
    await attach(f.repA, raised.id, a, 'one')

    await db.sql(`delete from public.bookings where id = $1`, [a])

    expect(await db.sql(
      `select id from public.incident_photos where incident_id = $1`, [raised.id]))
      .toHaveLength(0)
  })
})
