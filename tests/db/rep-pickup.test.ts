import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// R4 · Pickup flow. Every write path the screens in
// src/app/(app)/bookings/[id]/pickup drive, run from a rep session against the
// real policies and guard triggers — the same shape as
// rep-booking-screens.test.ts. What is under test is not that the forms work,
// but that the boundaries hold when the rep's session sends the request
// itself: another rep's booking, another rep's handover, the eligibility gate,
// and the fields a rep is never allowed to write.

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

/** The exact column set src/app/(app)/bookings/[id]/pickup/actions.ts sends. */
async function addDriver(
  rep: string,
  bookingId: string,
  over: Partial<{
    is_main: boolean; first: string; last: string; dob: string
    number: string; country: string; issued: string; expires: string
  }> = {},
) {
  return db.asUser(rep, () => db.one<{ id: string }>(
    `insert into public.booking_drivers
       (booking_id, is_main, first_name, last_name, dob,
        licence_number, licence_country, licence_issued_on, licence_expires_on)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      bookingId, over.is_main ?? true, over.first ?? 'Anna', over.last ?? 'Driver',
      over.dob ?? '1985-04-02', over.number ?? 'GR1234567', over.country ?? 'GR',
      over.issued ?? '2010-06-01', over.expires ?? '2032-06-01',
    ]))
}

async function fuelOut(rep: string, bookingId: string, eighths: number) {
  return db.asUser(rep, () => db.one<{ id: string }>(
    `insert into public.handovers (booking_id, kind, by_profile, fuel_eighths)
     values ($1, 'pickup', $2, $3)
     returning id`,
    [bookingId, rep, eighths]))
}

describe('R4 step 1 · drivers, typed in by hand', () => {
  test('the owning rep records a main driver with only the fields the form sends', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const driver = await addDriver(f.repA, bookingId)

    const row = await db.one<{
      is_main: boolean; licence_number: string
      front_image_path: string | null; back_image_path: string | null; ocr_reviewed: boolean
    }>(
      `select is_main, licence_number, front_image_path, back_image_path, ocr_reviewed
       from public.booking_drivers where id = $1`, [driver.id])

    expect(row.is_main).toBe(true)
    expect(row.licence_number).toBe('GR1234567')
    // Typed in by hand, so there are no images and nothing was read. §10 makes
    // this the first-class path: the camera in front of this form is a
    // convenience, and a driver recorded this way is complete.
    expect(row.front_image_path).toBeNull()
    expect(row.back_image_path).toBeNull()
  })

  test('the licence images live under the booking, one file per side per driver', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const driver = await addDriver(f.repA, bookingId)

    // Exactly what captureLicence() writes: the driver's own id is the
    // basename, so a re-take replaces the shot it corrects and the retention
    // sweep addresses one file per side.
    const front = `${bookingId}/licences/${driver.id}-front.jpg`
    const back = `${bookingId}/licences/${driver.id}-back.jpg`
    for (const name of [front, back]) {
      await db.asUser(f.repA, () => db.sql(
        `insert into storage.objects (bucket_id, name) values ('booking-files', $1)`, [name]))
    }
    await db.asUser(f.repA, () => db.sql(
      `update public.booking_drivers
          set front_image_path = $2, back_image_path = $3, ocr_confidence = 0.91, ocr_reviewed = false
        where id = $1`, [driver.id, front, back]))

    const row = await db.one<{
      front_image_path: string; back_image_path: string
      ocr_confidence: string; ocr_reviewed: boolean
    }>(`select front_image_path, back_image_path, ocr_confidence, ocr_reviewed
        from public.booking_drivers where id = $1`, [driver.id])

    expect(row.front_image_path).toBe(front)
    expect(Number(row.ocr_confidence)).toBeCloseTo(0.91, 2)
    // A machine filled the row in and no human has pressed Save yet.
    expect(row.ocr_reviewed).toBe(false)

    const seenByA = await db.asUser(f.repA, () => db.sql(
      `select name from storage.objects where bucket_id = 'booking-files' order by name`))
    expect(seenByA).toHaveLength(2)
  })

  test('another rep reaches neither the driver row nor either licence image', async () => {
    const bookingId = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })
    const driver = await addDriver(f.repB, bookingId)
    const front = `${bookingId}/licences/${driver.id}-front.jpg`
    await db.asUser(f.repB, () => db.sql(
      `insert into storage.objects (bucket_id, name) values ('booking-files', $1)`, [front]))

    // The row: refused by booking_drivers_rw.
    expect(await db.asUser(f.repA, () => db.sql(
      `select id from public.booking_drivers where id = $1`, [driver.id]))).toHaveLength(0)

    // The image, which is what a signed URL would be minted from: refused by
    // booking_files_select. Neither leak depends on the other being closed.
    expect(await db.asUser(f.repA, () => db.sql(
      `select name from storage.objects where name = $1`, [front]))).toHaveLength(0)
  })

  test('the audit log never carries a licence number or an image path', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const driver = await addDriver(f.repA, bookingId, { number: 'GR-SECRET-9' })
    await db.asUser(f.repA, () => db.sql(
      `update public.booking_drivers set front_image_path = $2 where id = $1`,
      [driver.id, `${bookingId}/licences/${driver.id}-front.jpg`]))

    const entries = await db.sql<{ after: Record<string, unknown> }>(
      `select after from public.audit_log where entity = 'booking_drivers' and entity_id = $1`,
      [driver.id])
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(Object.keys(entry.after)).not.toContain('licence_number')
      expect(Object.keys(entry.after)).not.toContain('front_image_path')
      expect(JSON.stringify(entry.after)).not.toContain('GR-SECRET-9')
    }
  })

  test('an additional driver is free — recording one does not change the total', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const before = await db.one<{ total: number }>(
      `select total from public.bookings where id = $1`, [bookingId])

    await addDriver(f.repA, bookingId)
    await addDriver(f.repA, bookingId, { is_main: false, first: 'Second', last: 'Driver' })

    const after = await db.one<{ total: number }>(
      `select total from public.bookings where id = $1`, [bookingId])
    expect(after.total).toBe(before.total)   // §9: free of charge
  })

  test('a rep cannot attach a driver to another rep\'s booking', async () => {
    const bookingId = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })

    expect(await errcode(() => addDriver(f.repA, bookingId))).toBe('42501')
  })

  test('a rep cannot read the drivers on another rep\'s booking', async () => {
    const bookingId = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })
    await addDriver(f.repB, bookingId)

    const seen = await db.asUser(f.repA, () => db.sql(
      `select id from public.booking_drivers where booking_id = $1`, [bookingId]))
    expect(seen).toHaveLength(0)
  })

  test('the rep covering the same hotel does see them — reps cover for each other', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await addDriver(f.repA, bookingId)

    const seen = await db.asUser(f.repCover, () => db.sql(
      `select id from public.booking_drivers where booking_id = $1`, [bookingId]))
    expect(seen).toHaveLength(1)
  })
})

describe('R4 step 2 · the eligibility gate is a hard block in the database', () => {
  async function pickUp(rep: string, bookingId: string) {
    return db.asUser(rep, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [bookingId]))
  }

  test('a driver too young for the category cannot be picked up (IR120)', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.carC, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    // catC needs 23; this driver is 22 on the pickup date.
    await addDriver(f.repA, bookingId, { dob: '2004-01-01' })

    expect(await errcode(() => pickUp(f.repA, bookingId))).toBe('IR120')

    const after = await db.one<{ status: string }>(
      `select status from public.bookings where id = $1`, [bookingId])
    expect(after.status).toBe('booked')   // failed loud, changed nothing
  })

  test('an ADDITIONAL driver failing blocks the pickup too — free, but still driving', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await addDriver(f.repA, bookingId)
    await addDriver(f.repA, bookingId, {
      is_main: false, first: 'Young', last: 'Friend', dob: '2008-01-01',
    })

    expect(await errcode(() => pickUp(f.repA, bookingId))).toBe('IR120')
  })

  test('a licence expiring during the rental blocks the pickup', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await addDriver(f.repA, bookingId, { expires: '2026-07-07' })

    expect(await errcode(() => pickUp(f.repA, bookingId))).toBe('IR120')
  })

  test('no driver at all is its own refusal (IR121), not a silent pass', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })

    expect(await errcode(() => pickUp(f.repA, bookingId))).toBe('IR121')
  })

  test('a rep cannot lift the gate themselves — the override RPC is admin-only (IR001)', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.carC, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await addDriver(f.repA, bookingId, { dob: '2004-01-01' })

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.admin_override_eligibility($1, 'let me through')`, [bookingId])))).toBe('IR001')

    // Nor by writing the override columns directly: they are not in the grant.
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set eligibility_override_at = now() where id = $1`, [bookingId]))))
      .toBe('42501')

    expect(await errcode(() => pickUp(f.repA, bookingId))).toBe('IR120')
  })

  test('the admin override opens the gate, and raises the exception the boss will see', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.carC, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await addDriver(f.repA, bookingId, { dob: '2004-01-01' })

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_override_eligibility($1, 'guest is a regular, boss approved')`, [bookingId]))

    await pickUp(f.repA, bookingId)

    const after = await db.one<{ status: string; eligibility_override_by: string }>(
      `select status, eligibility_override_by from public.bookings where id = $1`, [bookingId])
    expect(after.status).toBe('out')
    expect(after.eligibility_override_by).toBe(f.admin)

    const [raised] = await db.sql<{ type: string }>(
      `select type from public.exceptions where booking_id = $1`, [bookingId])
    expect(raised?.type).toBe('eligibility_override')
  })
})

describe('R4 step 3 · fuel out', () => {
  test('the pickup handover records the reading in eighths and nothing else', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const handover = await fuelOut(f.repA, bookingId, 8)

    const row = await db.one<{ kind: string; fuel_eighths: number; by_profile: string }>(
      `select kind, fuel_eighths, by_profile from public.handovers where id = $1`, [handover.id])
    expect(row.kind).toBe('pickup')
    expect(row.fuel_eighths).toBe(8)
    expect(row.by_profile).toBe(f.repA)
  })

  test('a reading outside 0–8 is refused by the column check, not clamped', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    expect(await errcode(() => fuelOut(f.repA, bookingId, 9))).toBe('23514')
  })

  test('one pickup handover per booking — a second is refused, so re-reading updates', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await fuelOut(f.repA, bookingId, 8)
    expect(await errcode(() => fuelOut(f.repA, bookingId, 6))).toBe('23505')
  })

  test('a rep cannot open a handover on another rep\'s booking', async () => {
    const bookingId = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })
    expect(await errcode(() => fuelOut(f.repA, bookingId, 8))).toBe('42501')
  })

  test('a rep cannot read another rep\'s handover', async () => {
    const bookingId = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })
    await fuelOut(f.repB, bookingId, 8)

    const seen = await db.asUser(f.repA, () => db.sql(
      `select id from public.handovers where booking_id = $1`, [bookingId]))
    expect(seen).toHaveLength(0)
  })
})

describe('R4 step 4 · the damage diagram', () => {
  async function mark(rep: string, handoverId: string, carId: string, over: Partial<{
    view: string; x: number; y: number; type: string; pre: boolean
  }> = {}) {
    return db.asUser(rep, () => db.one<{ id: string }>(
      `insert into public.damage_marks (handover_id, car_id, view, x, y, mark_type, pre_existing)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [handoverId, carId, over.view ?? 'front', over.x ?? 0.25, over.y ?? 0.5,
       over.type ?? 'scratch', over.pre ?? true]))
  }

  test('marks recorded at pickup are stored as pre-existing, with relative coordinates', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const handover = await fuelOut(f.repA, bookingId, 8)
    const created = await mark(f.repA, handover.id, f.car1, { view: 'left', x: 0.3125, y: 0.6 })

    const row = await db.one<{ view: string; x: string; y: string; pre_existing: boolean }>(
      `select view, x, y, pre_existing from public.damage_marks where id = $1`, [created.id])
    expect(row.view).toBe('left')
    expect(Number(row.x)).toBeCloseTo(0.3125, 4)
    expect(Number(row.y)).toBeCloseTo(0.6, 4)
    expect(row.pre_existing).toBe(true)
  })

  test('a coordinate outside the diagram is refused — 0–1 is a column check', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const handover = await fuelOut(f.repA, bookingId, 8)
    expect(await errcode(() => mark(f.repA, handover.id, f.car1, { x: 1.5 }))).toBe('23514')
  })

  test('an unknown view is refused — the five views are a column check', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const handover = await fuelOut(f.repA, bookingId, 8)
    expect(await errcode(() => mark(f.repA, handover.id, f.car1, { view: 'undercarriage' })))
      .toBe('23514')
  })

  test('a mark carries its photo, and the file sits under the booking it belongs to', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const handover = await fuelOut(f.repA, bookingId, 8)
    const created = await mark(f.repA, handover.id, f.car1)

    // The path src/lib/storage/paths.ts builds: the mark's own id is the
    // filename, so a re-take replaces the photo it corrects rather than
    // accumulating orphans (docs/01-DECISIONS.md §12).
    const photoPath = `${bookingId}/damage/${created.id}.jpg`
    await db.asUser(f.repA, () => db.sql(
      `insert into storage.objects (bucket_id, name) values ('booking-files', $1)`, [photoPath]))
    await db.asUser(f.repA, () => db.sql(
      `update public.damage_marks set photo_path = $2 where id = $1`, [created.id, photoPath]))

    const row = await db.one<{ photo_path: string }>(
      `select photo_path from public.damage_marks where id = $1`, [created.id])
    expect(row.photo_path).toBe(photoPath)

    // And the file is reachable by exactly the sessions the mark is.
    const seenByA = await db.asUser(f.repA, () => db.sql(
      `select name from storage.objects where name = $1`, [photoPath]))
    expect(seenByA).toHaveLength(1)

    const seenByB = await db.asUser(f.repB, () => db.sql(
      `select name from storage.objects where name = $1`, [photoPath]))
    expect(seenByB).toHaveLength(0)
  })

  test('a rep cannot point a mark at a photo of another booking', async () => {
    const mine = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const theirs = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })
    const handover = await fuelOut(f.repA, mine, 8)
    const created = await mark(f.repA, handover.id, f.car1)

    // Writing the STRING is not the leak — the path is only a key, and the
    // object policy is what decides. Rep A may name it and still not read it.
    const foreign = `${theirs}/damage/${created.id}.jpg`
    await db.asUser(f.repB, () => db.sql(
      `insert into storage.objects (bucket_id, name) values ('booking-files', $1)`, [foreign]))
    await db.asUser(f.repA, () => db.sql(
      `update public.damage_marks set photo_path = $2 where id = $1`, [created.id, foreign]))

    const seen = await db.asUser(f.repA, () => db.sql(
      `select name from storage.objects where name = $1`, [foreign]))
    expect(seen).toHaveLength(0)
  })

  test('a rep cannot mark damage on another rep\'s handover, nor read theirs', async () => {
    const bookingId = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })
    const handover = await fuelOut(f.repB, bookingId, 8)
    await mark(f.repB, handover.id, f.car3)

    expect(await errcode(() => mark(f.repA, handover.id, f.car3))).toBe('42501')

    const seen = await db.asUser(f.repA, () => db.sql(
      `select id from public.damage_marks where handover_id = $1`, [handover.id]))
    expect(seen).toHaveLength(0)
  })
})

describe('R4 step 7 · payment, and the money a rep may not touch', () => {
  test('the rep records what the guest handed over, and the price is untouched', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set collected = 90, pay_method = 'cash', paid = true
       where id = $1`, [bookingId]))

    const after = await db.one<{ collected: number; pay_method: string; paid: boolean; total: number }>(
      `select collected, pay_method, paid, total from public.bookings where id = $1`,
      [bookingId])
    expect(after.collected).toBe(90)
    expect(after.pay_method).toBe('cash')
    expect(after.paid).toBe(true)
    expect(after.total).toBe(90)   // set by the engine, never by this screen
  })

  test('a rep sending total alongside the payment is refused outright', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set collected = 100, total = 100 where id = $1`,
      [bookingId])))).toBe('42501')
  })
})

describe('R4 confirm · booked → out, the whole flow in one run', () => {
  test('an eligible driver, fuel, a mark and a payment produce an `out` rental', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await addDriver(f.repA, bookingId)
    const handover = await fuelOut(f.repA, bookingId, 8)
    await db.asUser(f.repA, () => db.sql(
      `insert into public.damage_marks (handover_id, car_id, view, x, y, mark_type, pre_existing)
       values ($1, $2, 'front', 0.4, 0.4, 'chip', true)`, [handover.id, f.car1]))
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set collected = 90, pay_method = 'cash', paid = true
       where id = $1`, [bookingId]))
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [bookingId]))

    const after = await db.one<{ status: string; days: number }>(
      `select status, days from public.bookings where id = $1`, [bookingId])
    expect(after.status).toBe('out')
    expect(after.days).toBe(3)   // Mon → Wed is 3 days, inclusive
  })

  test('the car stays occupied for the whole booked range once it is out', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await addDriver(f.repA, bookingId)
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [bookingId]))

    const avail = await db.asUser(f.repB, () => db.one<{ occupied_dates: string[] }>(
      `select occupied_dates from public.availability('2026-07-01', '2026-07-31') where car_id = $1`,
      [f.car1]))
    expect(avail.occupied_dates).toEqual(['2026-07-06', '2026-07-07', '2026-07-08'])
  })
})
