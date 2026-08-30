import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// The private bucket (supabase/migrations/20260830120000_storage.sql).
//
// docs/05-BUILD-PLAN.md's required isolation list includes "a rep's signed URL
// for their own licence image does not grant another booking's image". That is
// this file, and it is the point of the phase: the licence photos here are
// scanned driving licences of foreign tourists, and a leak is a reportable
// GDPR incident (docs/03-SECURITY.md).
//
// What is under test is the AUTHORISATION DECISION, not the storage API. The
// Supabase storage service does not mint a signed URL for an object the
// caller's SELECT policy refuses, and it does not accept an upload the INSERT
// policy refuses — so what a rep can and cannot reach is decided by exactly
// these policies, running here against the real Postgres every other policy in
// this repo is tested against (tests/helpers/supabase-shim.sql recreates
// storage.objects and storage.foldername()).
//
// What this file therefore does NOT cover is the HTTP layer: that a minted URL
// expires on time, and that the service honours the policy at all. Both are
// Supabase's own behaviour, exercised on a real project, not ours to assert
// here (docs/06-IMPLEMENTATION-NOTES.md).

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
})

const BUCKET = 'booking-files'

/** The path shape src/lib/storage/paths.ts builds: <booking>/<kind>/<file>. */
const at = (bookingId: string, kind: string, file: string) => `${bookingId}/${kind}/${file}`

/** An upload, as the storage API performs one: an insert under the caller's JWT. */
async function put(rep: string, name: string) {
  return db.asUser(rep, () => db.one<{ id: string }>(
    `insert into storage.objects (bucket_id, name, metadata)
     values ($1, $2, jsonb_build_object('mimetype', 'image/jpeg'))
     returning id`,
    [BUCKET, name]))
}

/** Everything this session can see at that name — what a signed URL is gated on. */
async function visible(rep: string, name: string) {
  return db.asUser(rep, () => db.sql<{ name: string }>(
    `select name from storage.objects where bucket_id = $1 and name = $2`, [BUCKET, name]))
}

describe('the bucket itself', () => {
  test('is private, size-capped and type-restricted', async () => {
    const bucket = await db.one<{
      public: boolean; file_size_limit: string; allowed_mime_types: string[]
    }>(`select public, file_size_limit, allowed_mime_types
        from storage.buckets where id = $1`, [BUCKET])

    expect(bucket.public).toBe(false)          // there is no public URL, ever
    expect(Number(bucket.file_size_limit)).toBe(10 * 1024 * 1024)
    expect(bucket.allowed_mime_types.sort()).toEqual(
      ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
  })

  test('a signed-out caller reaches nothing in it', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const path = at(bookingId, 'licences', 'a-front.jpg')
    await put(f.repA, path)

    const seen = await db.as({ kind: 'anon' }, () => db.sql(
      `select name from storage.objects where bucket_id = $1`, [BUCKET]))
    expect(seen).toHaveLength(0)
  })
})

describe("a rep's signed URL for their own licence image does not grant another booking's image", () => {
  test('the owning rep reaches their own; the other rep reaches nothing', async () => {
    const mine = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const theirs = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })

    const minePath = at(mine, 'licences', 'driver-front.jpg')
    const theirsPath = at(theirs, 'licences', 'driver-front.jpg')
    await put(f.repA, minePath)
    await put(f.repB, theirsPath)

    // Rep A holds a perfectly good session and a perfectly good path. The
    // policy still refuses, because the path names a booking that is not
    // theirs — which is why the URL cannot be minted.
    expect(await visible(f.repA, minePath)).toHaveLength(1)
    expect(await visible(f.repA, theirsPath)).toHaveLength(0)
    expect(await visible(f.repB, minePath)).toHaveLength(0)
  })

  test('nor by listing the folder, nor by walking the bucket', async () => {
    const mine = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const theirs = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })
    await put(f.repA, at(mine, 'licences', 'front.jpg'))
    await put(f.repB, at(theirs, 'licences', 'front.jpg'))
    await put(f.repB, at(theirs, 'licences', 'back.jpg'))

    const everything = await db.asUser(f.repA, () => db.sql<{ name: string }>(
      `select name from storage.objects where bucket_id = $1 order by name`, [BUCKET]))
    expect(everything.map((o) => o.name)).toEqual([at(mine, 'licences', 'front.jpg')])
  })

  test('a rep cannot upload INTO another booking either', async () => {
    const theirs = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })

    expect(await errcode(() => put(f.repA, at(theirs, 'licences', 'planted.jpg')))).toBe('42501')
  })

  test('the rep covering the same hotel does reach them — reps cover for each other', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const path = at(bookingId, 'licences', 'front.jpg')
    await put(f.repA, path)

    expect(await visible(f.repCover, path)).toHaveLength(1)
    expect(await visible(f.repB, path)).toHaveLength(0)
  })

  test('the admin reaches every booking\'s files', async () => {
    const a = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const b = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })
    await put(f.repA, at(a, 'licences', 'front.jpg'))
    await put(f.repB, at(b, 'licences', 'front.jpg'))

    const seen = await db.asUser(f.admin, () => db.sql(
      `select name from storage.objects where bucket_id = $1`, [BUCKET]))
    expect(seen).toHaveLength(2)
  })
})

describe('the path is the authorisation key, so a malformed one is a refusal', () => {
  test('a name that is not <booking>/<kind>/<file> is refused, not an error', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })

    for (const name of [
      'front.jpg',                              // no folders at all
      `${bookingId}/front.jpg`,                 // no kind
      `${bookingId}/licences/nested/front.jpg`, // too deep
      'not-a-uuid/licences/front.jpg',          // first segment is not a booking
      `${bookingId}/notes/front.jpg`,           // unknown kind
    ]) {
      expect(await errcode(() => put(f.repA, name)), name).toBe('42501')
    }
  })

  test('a booking id that is well-formed but not theirs is still a refusal', async () => {
    const stranger = '00000000-0000-4000-8000-000000000000'
    expect(await errcode(() => put(f.repA, at(stranger, 'licences', 'front.jpg')))).toBe('42501')
  })

  test('a rep cannot reach another BUCKET by naming a readable booking', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await db.sql(`insert into storage.buckets (id, name, public) values ('other', 'other', false)`)

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into storage.objects (bucket_id, name) values ('other', $1)`,
      [at(bookingId, 'licences', 'front.jpg')])))).toBe('42501')
  })
})

describe('a signed agreement is evidence — the bucket treats it as immutable', () => {
  test('a rep may replace and delete a licence photo — a re-take corrects a mis-shot', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const path = at(bookingId, 'licences', 'front.jpg')
    await put(f.repA, path)

    await db.asUser(f.repA, () => db.sql(
      `update storage.objects set updated_at = now() where bucket_id = $1 and name = $2`,
      [BUCKET, path]))
    await db.asUser(f.repA, () => db.sql(
      `delete from storage.objects where bucket_id = $1 and name = $2`, [BUCKET, path]))

    expect(await visible(f.repA, path)).toHaveLength(0)
  })

  test('the same is true of a damage photo', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const path = at(bookingId, 'damage', 'mark.jpg')
    await put(f.repA, path)

    await db.asUser(f.repA, () => db.sql(
      `delete from storage.objects where bucket_id = $1 and name = $2`, [BUCKET, path]))
    expect(await visible(f.repA, path)).toHaveLength(0)
  })

  test('but the signature and the contract PDF cannot be overwritten or deleted', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const signature = at(bookingId, 'signature', 'sig.png')
    const contract = at(bookingId, 'contract', 'agreement.pdf')
    await put(f.repA, signature)
    await put(f.repA, contract)

    for (const path of [signature, contract]) {
      // No update or delete policy covers these kinds, so the statement finds
      // no rows to act on rather than raising — the row survives either way,
      // which is the property that matters.
      await db.asUser(f.repA, () => db.sql(
        `delete from storage.objects where bucket_id = $1 and name = $2`, [BUCKET, path]))
      expect(await visible(f.repA, path), path).toHaveLength(1)
    }

    // Not the admin either: correcting a signed agreement means a new contract
    // row and a new file, never editing the one the guest signed.
    await db.asUser(f.admin, () => db.sql(
      `delete from storage.objects where bucket_id = $1 and name = $2`, [BUCKET, contract]))
    expect(await visible(f.admin, contract)).toHaveLength(1)
  })

  test('the retention job still reaches everything — it runs as the service role', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await put(f.repA, at(bookingId, 'licences', 'front.jpg'))
    await put(f.repA, at(bookingId, 'contract', 'agreement.pdf'))

    // §25: the licence images are purged, the contract PDF is retained. The
    // folder split is what lets the sweep say that without parsing filenames.
    const purgeable = await db.as({ kind: 'service' }, () => db.sql<{ name: string }>(
      `select name from storage.objects
        where bucket_id = $1 and (storage.foldername(name))[2] = 'licences'`, [BUCKET]))
    expect(purgeable.map((o) => o.name)).toEqual([at(bookingId, 'licences', 'front.jpg')])

    await db.as({ kind: 'service' }, () => db.sql(
      `delete from storage.objects
        where bucket_id = $1 and (storage.foldername(name))[2] = 'licences'`, [BUCKET]))

    const left = await db.as({ kind: 'service' }, () => db.sql<{ name: string }>(
      `select name from storage.objects where bucket_id = $1`, [BUCKET]))
    expect(left.map((o) => o.name)).toEqual([at(bookingId, 'contract', 'agreement.pdf')])
  })
})

describe('retention does not depend on the pointer column', () => {
  test('the sweep reads the BUCKET, so a cleared front_image_path hides nothing', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const driver = await db.asUser(f.repA, () => db.one<{ id: string }>(
      `insert into public.booking_drivers
         (booking_id, is_main, first_name, last_name, dob, licence_number, licence_country,
          licence_issued_on, licence_expires_on, front_image_path)
       values ($1, true, 'A', 'B', '1985-01-01', 'X', 'GR', '2010-01-01', '2032-01-01', $2)
       returning id`,
      [bookingId, `${bookingId}/licences/x-front.jpg`]))
    await put(f.repA, at(bookingId, 'licences', 'x-front.jpg'))

    // `booking_drivers` is granted to `authenticated` at table level, so a rep
    // CAN clear their own driver's image pointer. That must not be a way to
    // make a scanned licence outlive the retention window
    // (docs/01-DECISIONS.md §25) — which is exactly why the purge is driven by
    // the bucket layout and not by this column.
    await db.asUser(f.repA, () => db.sql(
      `update public.booking_drivers set front_image_path = null where id = $1`, [driver.id]))

    const purgeable = await db.as({ kind: 'service' }, () => db.sql<{ name: string }>(
      `select name from storage.objects
        where bucket_id = $1 and (storage.foldername(name))[2] = 'licences'`, [BUCKET]))
    expect(purgeable.map((o) => o.name)).toEqual([at(bookingId, 'licences', 'x-front.jpg')])
  })
})

describe('a cancelled booking does not orphan its files into visibility', () => {
  test('the creating rep keeps their own; nobody else gains anything', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const path = at(bookingId, 'licences', 'front.jpg')
    await put(f.repA, path)

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'cancelled' where id = $1`, [bookingId]))

    expect(await visible(f.repA, path)).toHaveLength(1)
    expect(await visible(f.repB, path)).toHaveLength(0)
  })
})
