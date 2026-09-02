import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

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

const START = '2026-07-06'
const END = '2026-07-10'

// A licence held for years and valid well past the return date, so each test
// below varies exactly one thing.
const GOOD_LICENCE = { issued: '2010-05-01', expires: '2030-05-01' }

type Result = { ok: boolean; failures: string[] }

async function check(
  categoryId: string,
  driver: { dob: string; issued?: string | null; expires?: string | null },
  as = f.repA,
): Promise<Result> {
  return db.asUser(as, () => db.one<Result>(
    `select ok, failures from public.check_eligibility($1, $2, $3, $4, $5, $6)`,
    [categoryId, driver.dob,
     driver.issued === undefined ? GOOD_LICENCE.issued : driver.issued,
     driver.expires === undefined ? GOOD_LICENCE.expires : driver.expires,
     START, END]))
}

describe('age', () => {
  test('20 years old on category A is blocked — the minimum is 21', async () => {
    const r = await check(f.catA, { dob: '2006-07-06' })
    expect(r.ok).toBe(false)
    expect(r.failures).toContain('age')
  })

  test('22 years old on category C is blocked — the minimum is 23', async () => {
    const r = await check(f.catC, { dob: '2004-07-06' })
    expect(r.ok).toBe(false)
    expect(r.failures).toContain('age')
  })

  test('22 years old on category B is allowed', async () => {
    expect(await check(f.catB, { dob: '2004-07-06' })).toEqual({ ok: true, failures: [] })
  })

  test('the minimum is measured on the pickup date, to the day', async () => {
    // Turns 21 the day after pickup.
    expect((await check(f.catA, { dob: '2005-07-07' })).failures).toContain('age')
    // Turns 21 on the pickup date itself.
    expect(await check(f.catA, { dob: '2005-07-06' })).toEqual({ ok: true, failures: [] })
  })

  test('the minimum comes from the category row, not from application code', async () => {
    const twentyTwo = { dob: '2004-07-06' }
    expect((await check(f.catC, twentyTwo)).ok).toBe(false)

    await db.asUser(f.admin, () => db.sql(
      `update public.categories set min_driver_age = 21 where id = $1`, [f.catC]))
    expect((await check(f.catC, twentyTwo)).ok).toBe(true)

    await db.asUser(f.admin, () => db.sql(
      `update public.categories set min_driver_age = 23 where id = $1`, [f.catC]))
  })
})

describe('the licence', () => {
  test('held for 11 months is blocked — a year is the minimum', async () => {
    const r = await check(f.catB, { dob: '1990-01-01', issued: '2025-08-06' })
    expect(r.ok).toBe(false)
    expect(r.failures).toContain('licence_held')
  })

  test('held for exactly a year on the pickup date is allowed', async () => {
    expect(await check(f.catB, { dob: '1990-01-01', issued: '2025-07-06' }))
      .toEqual({ ok: true, failures: [] })
  })

  test('expiring during the rental is blocked', async () => {
    const r = await check(f.catB, { dob: '1990-01-01', expires: '2026-07-08' })
    expect(r.ok).toBe(false)
    expect(r.failures).toContain('licence_expired')
  })

  test('valid through the final day of the rental is allowed', async () => {
    expect(await check(f.catB, { dob: '1990-01-01', expires: END }))
      .toEqual({ ok: true, failures: [] })
  })

  test('missing data is reported, not assumed either way', async () => {
    const r = await check(f.catB, { dob: '1990-01-01', issued: null, expires: null })
    expect(r.ok).toBe(false)
    expect(r.failures).toEqual(
      expect.arrayContaining(['licence_issue_date_missing', 'licence_expiry_missing']))
  })

  test('several failures come back together, so the screen can say all of them', async () => {
    const r = await check(f.catC, { dob: '2006-07-06', issued: '2025-08-06', expires: '2026-07-08' })
    expect(r.failures.sort()).toEqual(['age', 'licence_expired', 'licence_held'])
  })
})

describe('the hard block on pickup', () => {
  async function bookingWithDriver(driver: {
    dob: string; issued?: string; expires?: string; main?: boolean
  }, carId = f.car1): Promise<string> {
    const id = await bookAsRep(db, f.repA, {
      carId, hotelId: f.hotelA, start: START, end: END,
    })
    await db.asUser(f.repA, () => db.sql(
      `insert into public.booking_drivers
         (booking_id, is_main, first_name, last_name, dob,
          licence_number, licence_country, licence_issued_on, licence_expires_on)
       values ($1, $2, 'Test', 'Driver', $3, 'X1', 'GB', $4, $5)`,
      [id, driver.main ?? true, driver.dob,
       driver.issued ?? GOOD_LICENCE.issued, driver.expires ?? GOOD_LICENCE.expires]))
    return id
  }

  const goOut = (id: string, as = f.repA) => db.asUser(as, () => db.sql(
    `update public.bookings set status = 'out' where id = $1`, [id]))

  test('an eligible driver can be picked up', async () => {
    const id = await bookingWithDriver({ dob: '1990-01-01' })
    await expect(goOut(id)).resolves.toBeTruthy()
  })

  test('a rep cannot push a failing driver past the gate', async () => {
    const id = await bookingWithDriver({ dob: '2006-07-06' })
    expect(await errcode(() => goOut(id))).toBe('IR120')
  })

  test('neither can the admin — the way past is a recorded override', async () => {
    const id = await bookingWithDriver({ dob: '2006-07-06' })
    expect(await errcode(() => goOut(id, f.admin))).toBe('IR120')
  })

  test('a failing ADDITIONAL driver blocks the pickup too', async () => {
    const id = await bookingWithDriver({ dob: '1990-01-01' })
    await db.asUser(f.repA, () => db.sql(
      `insert into public.booking_drivers
         (booking_id, is_main, first_name, last_name, dob,
          licence_number, licence_country, licence_issued_on, licence_expires_on)
       values ($1, false, 'Young', 'Friend', '2006-07-06', 'X2', 'GB', '2010-05-01', '2030-05-01')`,
      [id]))
    expect(await errcode(() => goOut(id))).toBe('IR120')
  })

  test('a pickup with no driver on the booking at all is refused', async () => {
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: START, end: END,
    })
    expect(await errcode(() => goOut(id))).toBe('IR121')
  })

  test('the admin override unblocks the pickup, and is recorded on the booking alone', async () => {
    const id = await bookingWithDriver({ dob: '2006-07-06' })
    expect(await errcode(() => goOut(id))).toBe('IR120')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_override_eligibility($1, 'Boss approved at the desk')`, [id]))

    await expect(goOut(id)).resolves.toBeTruthy()

    const booking = await db.one<{ eligibility_override_by: string; eligibility_override_at: Date }>(
      `select eligibility_override_by, eligibility_override_at
         from public.bookings where id = $1`, [id])
    expect(booking.eligibility_override_by).toBe(f.admin)
    expect(booking.eligibility_override_at).not.toBeNull()

    // It does NOT raise an incident (0030). Only the boss can override, so a
    // queue item would be him asking himself to look at what he just did — the
    // booking's own two columns and the audit log are the record.
    const raised = await db.sql(
      `select id from public.incidents where booking_id = $1`, [id])
    expect(raised).toHaveLength(0)
  })

  test('a rep cannot grant themselves the override', async () => {
    const id = await bookingWithDriver({ dob: '2006-07-06' })

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.admin_override_eligibility($1, 'let me through')`, [id])))).toBe('IR001')

    // …nor by writing the columns directly: they are in no client grant.
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set eligibility_override_at = now() where id = $1`, [id]))))
      .toBe('42501')   // insufficient_privilege

    expect(await errcode(() => goOut(id))).toBe('IR120')
  })
})
