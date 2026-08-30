import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// R4 steps 5 and 6 — signing the agreement and posting a copy of it, run from
// a rep session against the real policies, the object policies and the guard
// trigger added in supabase/migrations/20260830130000_contract_signing.sql.
//
// A signed rental agreement is evidence. Almost everything here is therefore a
// test about what CANNOT be changed once it exists: not the file, not the
// signer, not the timestamp, and not by the admin either. The two exceptions
// are the two columns the copy step writes.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.sql(`delete from storage.objects`)
  await db.sql(`delete from public.bookings`)
  // Deleting the bookings cascades to their contracts and marks, and the audit
  // trigger records every one of those deletes — so the log is cleared after
  // them, not before, or the two audit tests below count the previous test's
  // teardown.
  await db.sql(`delete from public.audit_log`)
})

/** Everything src/app/(app)/bookings/[id]/pickup/contract-actions.ts writes. */
async function sign(rep: string, bookingId: string, over: { signer?: string } = {}) {
  const signature = `${bookingId}/signature/sig-1.png`
  const pdf = `${bookingId}/contract/agreement-1.pdf`

  for (const name of [signature, pdf]) {
    await db.asUser(rep, () => db.sql(
      `insert into storage.objects (bucket_id, name) values ('booking-files', $1)`, [name]))
  }

  return db.asUser(rep, () => db.one<{ id: string; version: number; signed_at: string }>(
    `insert into public.contracts (booking_id, pdf_path, signature_path, signer_name)
     values ($1, $2, $3, $4)
     returning id, version, signed_at`,
    [bookingId, pdf, signature, over.signer ?? 'Anna Visitor']))
}

async function booking(rep: string, carId: string, hotelId: string) {
  return bookAsRep(db, rep, { carId, hotelId, start: '2026-07-06', end: '2026-07-08' })
}

describe('signing', () => {
  test('the owning rep stores the signature, the PDF and the row', async () => {
    const id = await booking(f.repA, f.car1, f.hotelA)
    const contract = await sign(f.repA, id)

    const row = await db.one<{
      booking_id: string; pdf_path: string; signature_path: string
      signer_name: string; emailed_to: string | null; version: number
    }>(`select booking_id, pdf_path, signature_path, signer_name, emailed_to, version
        from public.contracts where id = $1`, [contract.id])

    expect(row.booking_id).toBe(id)
    expect(row.signer_name).toBe('Anna Visitor')
    expect(row.pdf_path).toBe(`${id}/contract/agreement-1.pdf`)
    expect(row.emailed_to).toBeNull()
    expect(row.version).toBe(1)
  })

  test('the signature and the PDF are reachable by exactly the sessions the booking is', async () => {
    const id = await booking(f.repA, f.car1, f.hotelA)
    await sign(f.repA, id)

    const forRepA = await db.asUser(f.repA, () => db.sql(
      `select name from storage.objects where bucket_id = 'booking-files'`))
    expect(forRepA).toHaveLength(2)

    const forRepB = await db.asUser(f.repB, () => db.sql(
      `select name from storage.objects where bucket_id = 'booking-files'`))
    expect(forRepB).toHaveLength(0)

    // The cover rep sees the booking, so they see its agreement.
    const forCover = await db.asUser(f.repCover, () => db.sql(
      `select id from public.contracts where booking_id = $1`, [id]))
    expect(forCover).toHaveLength(1)
  })

  test('a rep cannot sign another rep\'s booking', async () => {
    const theirs = await booking(f.repB, f.car3, f.hotelB)

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.contracts (booking_id, pdf_path, signature_path, signer_name)
       values ($1, 'p', 's', 'Forged')`, [theirs])))).toBe('42501')
  })

  test('a rep cannot read another rep\'s contract', async () => {
    const theirs = await booking(f.repB, f.car3, f.hotelB)
    await sign(f.repB, theirs)

    expect(await db.asUser(f.repA, () => db.sql(
      `select id from public.contracts where booking_id = $1`, [theirs]))).toHaveLength(0)
  })

  test('when it was signed is the database\'s answer, not the client\'s', async () => {
    const id = await booking(f.repA, f.car1, f.hotelA)

    const contract = await db.asUser(f.repA, () => db.one<{ signed_at: string; version: number }>(
      `insert into public.contracts
         (booking_id, pdf_path, signature_path, signer_name, signed_at, version)
       values ($1, 'p', 's', 'Anna', '2001-01-01', 99)
       returning signed_at, version`, [id]))

    // Before the guard, both of these were taken as sent. A back-dated
    // signature is exactly the kind of fact a dispute turns on.
    expect(new Date(contract.signed_at).getFullYear()).toBeGreaterThan(2020)
    expect(contract.version).toBe(1)
  })

  test('signing again is a new version, and the first one survives', async () => {
    const id = await booking(f.repA, f.car1, f.hotelA)
    await sign(f.repA, id)

    const second = await db.asUser(f.repA, () => db.one<{ version: number }>(
      `insert into public.contracts (booking_id, pdf_path, signature_path, signer_name)
       values ($1, 'p2', 's2', 'Anna Visitor') returning version`, [id]))
    expect(second.version).toBe(2)

    const all = await db.asUser(f.repA, () => db.sql(
      `select id from public.contracts where booking_id = $1`, [id]))
    expect(all).toHaveLength(2)
  })
})

describe('a signed agreement cannot be altered afterwards', () => {
  test('not the file it points at, not the signer, not the timestamp', async () => {
    const id = await booking(f.repA, f.car1, f.hotelA)
    const contract = await sign(f.repA, id)

    // The column grant covers `emailed_to` and `emailed_at` only, so the
    // statement is refused outright before the guard is even reached.
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.contracts set signer_name = 'Someone Else' where id = $1`,
      [contract.id])))).toBe('42501')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.contracts set pdf_path = 'elsewhere' where id = $1`,
      [contract.id])))).toBe('42501')

    // And if the grant were ever widened, the guard still restores them. Run
    // as the fixture superuser, which the column grant does not constrain.
    await db.sql(
      `update public.contracts
          set signer_name = 'Someone Else', pdf_path = 'elsewhere', signed_at = '2001-01-01'
        where id = $1`, [contract.id])

    const after = await db.one<{ signer_name: string; pdf_path: string; signed_at: string }>(
      `select signer_name, pdf_path, signed_at from public.contracts where id = $1`, [contract.id])
    expect(after.signer_name).toBe('Anna Visitor')
    expect(after.pdf_path).toBe(`${id}/contract/agreement-1.pdf`)
    expect(new Date(after.signed_at).getFullYear()).toBeGreaterThan(2020)
  })

  test('nobody can delete it — not the rep, not the admin', async () => {
    const id = await booking(f.repA, f.car1, f.hotelA)
    const contract = await sign(f.repA, id)

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `delete from public.contracts where id = $1`, [contract.id])))).toBe('42501')
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `delete from public.contracts where id = $1`, [contract.id])))).toBe('42501')

    expect(await db.sql(
      `select id from public.contracts where id = $1`, [contract.id])).toHaveLength(1)
  })

  test('and the stored PDF cannot be overwritten or removed either', async () => {
    const id = await booking(f.repA, f.car1, f.hotelA)
    await sign(f.repA, id)
    const pdf = `${id}/contract/agreement-1.pdf`

    await db.asUser(f.repA, () => db.sql(
      `delete from storage.objects where bucket_id = 'booking-files' and name = $1`, [pdf]))

    expect(await db.asUser(f.repA, () => db.sql(
      `select name from storage.objects where name = $1`, [pdf]))).toHaveLength(1)
  })
})

describe('the emailed copy — the only two columns anyone may move', () => {
  test('the rep records the address and the send', async () => {
    const id = await booking(f.repA, f.car1, f.hotelA)
    const contract = await sign(f.repA, id)

    await db.asUser(f.repA, () => db.sql(
      `update public.contracts set emailed_to = $2, emailed_at = now() where id = $1`,
      [contract.id, 'guest@example.com']))

    const row = await db.one<{ emailed_to: string; emailed_at: string | null }>(
      `select emailed_to, emailed_at from public.contracts where id = $1`, [contract.id])
    expect(row.emailed_to).toBe('guest@example.com')
    expect(row.emailed_at).not.toBeNull()
  })

  test('an address recorded with no send leaves emailed_at null', async () => {
    // The state this installation is actually in: no SMTP credentials, so the
    // address is kept and the copy has not gone out (src/lib/email/mailer.ts).
    const id = await booking(f.repA, f.car1, f.hotelA)
    const contract = await sign(f.repA, id)

    await db.asUser(f.repA, () => db.sql(
      `update public.contracts set emailed_to = $2, emailed_at = null where id = $1`,
      [contract.id, 'guest@example.com']))

    const row = await db.one<{ emailed_to: string; emailed_at: string | null }>(
      `select emailed_to, emailed_at from public.contracts where id = $1`, [contract.id])
    expect(row.emailed_to).toBe('guest@example.com')
    expect(row.emailed_at).toBeNull()
  })

  test('a rep cannot record a copy against another rep\'s contract', async () => {
    const theirs = await booking(f.repB, f.car3, f.hotelB)
    const contract = await sign(f.repB, theirs)

    // The policy matches no row for rep A, so the statement changes nothing.
    await db.asUser(f.repA, () => db.sql(
      `update public.contracts set emailed_to = 'attacker@example.com' where id = $1`,
      [contract.id]))

    const row = await db.one<{ emailed_to: string | null }>(
      `select emailed_to from public.contracts where id = $1`, [contract.id])
    expect(row.emailed_to).toBeNull()
  })
})

describe('the agreement is a step, not a gate', () => {
  test('a pickup completes without one — eligibility is the only hard block', async () => {
    // docs/01-DECISIONS.md §11 makes eligibility the hard block and nothing
    // else. Requiring a signed contract to reach `out` would be an invented
    // rule, and an unworkable one while the client's terms are outstanding.
    const id = await booking(f.repA, f.car1, f.hotelA)
    await db.asUser(f.repA, () => db.sql(
      `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob,
         licence_number, licence_country, licence_issued_on, licence_expires_on)
       values ($1, true, 'Anna', 'Visitor', '1985-04-02', 'GR1', 'GR', '2010-01-01', '2032-01-01')`,
      [id]))

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [id]))

    const after = await db.one<{ status: string }>(
      `select status from public.bookings where id = $1`, [id])
    expect(after.status).toBe('out')
    expect(await db.sql(`select id from public.contracts where booking_id = $1`, [id]))
      .toHaveLength(0)
  })
})

describe('audit', () => {
  test('signing is logged, without the stored paths', async () => {
    const id = await booking(f.repA, f.car1, f.hotelA)
    await sign(f.repA, id)

    const entries = await db.sql<{ actor_id: string; action: string; after: Record<string, unknown> }>(
      `select actor_id, action, after from public.audit_log where entity = 'contracts'`)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.actor_id).toBe(f.repA)
    expect(entries[0]?.action).toBe('insert')
    // Who signed and when is the point of the log; where the file sits is not,
    // and the log is not a second index of where the personal data lives.
    expect(entries[0]?.after).toHaveProperty('signer_name')
    expect(Object.keys(entries[0]?.after ?? {})).not.toContain('pdf_path')
    expect(Object.keys(entries[0]?.after ?? {})).not.toContain('signature_path')
  })

  test('a damage mark is logged too, without its photo path', async () => {
    const id = await booking(f.repA, f.car1, f.hotelA)
    const handover = await db.asUser(f.repA, () => db.one<{ id: string }>(
      `insert into public.handovers (booking_id, kind, by_profile, fuel_eighths)
       values ($1, 'pickup', $2, 8) returning id`, [id, f.repA]))
    await db.asUser(f.repA, () => db.sql(
      `insert into public.damage_marks (handover_id, car_id, view, x, y, mark_type, pre_existing, photo_path)
       values ($1, $2, 'front', 0.4, 0.4, 'chip', true, 'p/damage/x.jpg')`,
      [handover.id, f.car1]))

    const entries = await db.sql<{ after: Record<string, unknown> }>(
      `select after from public.audit_log where entity = 'damage_marks'`)
    expect(entries).toHaveLength(1)
    expect(Object.keys(entries[0]?.after ?? {})).not.toContain('photo_path')
    expect(entries[0]?.after).toHaveProperty('mark_type')
  })
})
