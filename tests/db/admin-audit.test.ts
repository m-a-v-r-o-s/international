import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// A9 · Audit log (docs/04-SCREENS.md), read through
// supabase/migrations/20260830180000_audit_viewer.sql.
//
// docs/01-DECISIONS.md §19: every change is audit-logged with actor, entity,
// before, after and timestamp, and the log is permanent. The tests that matter
// most here are the negative ones: a rep reaches none of it, and NOTHING that
// app.audit_redact() strips on the way in comes back out through this screen's
// query. An audit viewer that quietly re-assembles redacted personal data
// would be the last place anybody thought to look for a leak.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.sql(`delete from public.bookings`)
  await db.sql(`delete from public.audit_log`)
})

type Entry = {
  id: number
  actor_id: string | null
  actor_name: string | null
  entity: string
  action: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

const read = (args: Record<string, unknown> = {}, who = f.admin) =>
  db.asUser(who, () => db.sql<Entry>(
    `select id, actor_id, actor_name, entity, action, before, after
     from public.admin_audit_log($1, $2, $3, $4, $5, $6)`,
    [
      args.actor ?? null, args.entity ?? null, args.from ?? null,
      args.to ?? null, args.limit ?? 50, args.offset ?? 0,
    ]))

describe('who may read it', () => {
  test('the admin, and nobody else', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select id from public.admin_audit_log(null, null, null, null, 50, 0)`)))).toBe('IR001')
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select entity from public.admin_audit_entities()`)))).toBe('IR001')

    // Nor by reading the table straight, which is the policy from Phase 1.
    expect(await db.asUser(f.repA, () => db.sql(
      `select id from public.audit_log`))).toHaveLength(0)
  })

  test('and it is read-only for everyone — no client role may write it', async () => {
    for (const who of [f.admin, f.repA]) {
      expect(await errcode(() => db.asUser(who, () => db.sql(
        `insert into public.audit_log (entity, action) values ('bookings', 'insert')`))))
        .toBe('42501')
      expect(await errcode(() => db.asUser(who, () => db.sql(
        `delete from public.audit_log`)))).toBe('42501')
      expect(await errcode(() => db.asUser(who, () => db.sql(
        `update public.audit_log set entity = 'x'`)))).toBe('42501')
    }
  })
})

describe('what it records', () => {
  test('the actor, resolved to a name the boss recognises', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })

    const entries = await read({ entity: 'bookings' })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.actor_id).toBe(f.repA)
    expect(entries[0]?.actor_name).toBe('Rep A')
    expect(entries[0]?.action).toBe('insert')
  })

  test('newest first, and paged without a count over a permanent table', async () => {
    // Three genuinely different values: app.audit() returns null for an update
    // that changed nothing, so writing the same address twice logs once.
    for (const address of ['One Street', 'Two Street', 'Three Street']) {
      await db.asUser(f.admin, () => db.sql(
        `update public.hotels set address = $1 where id = $2`, [address, f.hotelA]))
    }

    const firstPage = await read({ entity: 'hotels', limit: 2, offset: 0 })
    const secondPage = await read({ entity: 'hotels', limit: 2, offset: 2 })

    // audit_log.id is a bigserial, which node-postgres hands back as a string
    // so a value past 2^53 cannot silently lose precision.
    const id = (e: Entry) => Number(e.id)

    expect(firstPage).toHaveLength(2)
    expect(id(firstPage[0]!)).toBeGreaterThan(id(firstPage[1]!))
    expect(id(secondPage[0]!)).toBeLessThan(id(firstPage[1]!))
  })

  test('a write by the server itself has no actor, and says so rather than lying', async () => {
    // The retention job and the triggers run with auth.uid() null.
    await db.sql(`update public.hotels set area = 'Set by the server' where id = $1`, [f.hotelA])

    const entries = await read({ entity: 'hotels' })
    expect(entries[0]?.actor_id).toBeNull()
    expect(entries[0]?.actor_name).toBeNull()
  })
})

describe('the filters', () => {
  beforeEach(async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    // Unique each time, for the same reason: an update that changes nothing
    // is not an event and is not logged.
    await db.asUser(f.admin, () => db.sql(
      `update public.hotels set area = 'Area ' || clock_timestamp()::text where id = $1`,
      [f.hotelA]))
  })

  test('by actor', async () => {
    const byRep = await read({ actor: f.repA })
    const byAdmin = await read({ actor: f.admin })

    expect(byRep.every((e) => e.actor_id === f.repA)).toBe(true)
    expect(byAdmin.map((e) => e.entity)).toEqual(['hotels'])
  })

  test('by entity', async () => {
    expect((await read({ entity: 'hotels' })).every((e) => e.entity === 'hotels')).toBe(true)
    expect(await read({ entity: 'cars' })).toHaveLength(0)
  })

  test('by date, inclusive at both ends and measured in Athens time', async () => {
    const today = await db.one<{ d: string }>(`select app.today() as d`)

    expect((await read({ from: today.d, to: today.d })).length).toBeGreaterThan(0)
    expect(await read({ from: today.d, to: today.d, entity: 'cars' })).toHaveLength(0)

    // A day either side of the entry excludes it.
    const yesterday = await db.one<{ d: string }>(`select (app.today() - 1) as d`)
    expect(await read({ from: yesterday.d, to: yesterday.d })).toHaveLength(0)
  })

  test('the entity list offers what the log actually holds', async () => {
    const entities = await db.asUser(f.admin, () => db.sql<{ entity: string }>(
      `select entity from public.admin_audit_entities()`))
    expect(entities.map((e) => e.entity).sort()).toEqual(['bookings', 'hotels'])
  })
})

describe('nothing redacted comes back out', () => {
  test('a driver\'s licence number and image paths are absent from the entry', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await db.asUser(f.repA, () => db.sql(
      `insert into public.booking_drivers
         (booking_id, is_main, first_name, last_name, dob, licence_number, licence_country,
          front_image_path, back_image_path)
       values ($1, true, 'Anna', 'Visitor', '1985-01-01', 'LIC-SECRET-12345', 'GR', $2, $3)`,
      [bookingId, `${bookingId}/licences/f.jpg`, `${bookingId}/licences/b.jpg`]))

    const entries = await read({ entity: 'booking_drivers' })
    expect(entries).toHaveLength(1)

    const after = entries[0]!.after!
    // Who added a driver, and their name, is the accountability the log is
    // for. Where the scan sits and what the card says is not.
    expect(after.first_name).toBe('Anna')
    expect(after).not.toHaveProperty('licence_number')
    expect(after).not.toHaveProperty('front_image_path')
    expect(after).not.toHaveProperty('back_image_path')

    // And not anywhere else in the row either, whatever the shape.
    expect(JSON.stringify(entries)).not.toContain('LIC-SECRET-12345')
    expect(JSON.stringify(entries)).not.toContain('/licences/')
  })

  test('a signed agreement\'s stored paths are absent too', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await db.asUser(f.repA, () => db.sql(
      `insert into public.contracts (booking_id, pdf_path, signature_path, signer_name)
       values ($1, $2, $3, 'Anna Visitor')`,
      [bookingId, `${bookingId}/contract/a.pdf`, `${bookingId}/signature/s.png`]))

    const entries = await read({ entity: 'contracts' })
    const after = entries[0]!.after!

    expect(after.signer_name).toBe('Anna Visitor')
    expect(after.signed_at).toBeTruthy()
    expect(after).not.toHaveProperty('pdf_path')
    expect(after).not.toHaveProperty('signature_path')
  })

  test('a PIN hash never reaches it', async () => {
    await db.asUser(f.repA, () => db.sql(
      `update public.profiles set pin_hash = 'argon2id$secret' where id = $1`, [f.repA]))

    const entries = await read({ entity: 'profiles' })
    expect(JSON.stringify(entries)).not.toContain('argon2id$secret')
  })
})
