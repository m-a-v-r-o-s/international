import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, type Fixtures } from '../helpers/fixtures'

// docs/01-DECISIONS.md §30 — "even the boss makes bookings sometimes".
//
// The admin gains the rep's operational screens without losing anything of his
// own, and these tests are the database half of that: the same inserts and
// transitions the rep screens perform, run from an ADMIN session, through the
// real policies and guard triggers.
//
// The load-bearing one is the first. `created_by` is not null with no default
// and is absent from the INSERT grant, and app.bookings_before_write() filled
// it only inside `if not v_is_admin` — so before 0026 every one of these was a
// NOT NULL violation rather than a booking.

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

describe('§30 · an admin creating a rental the way a rep does', () => {
  test('the insert succeeds and the row is authored by the admin', async () => {
    const booking = await db.asUser(f.admin, () => db.one<{
      id: string; ref: string; kind: string; status: string
      created_by: string; days: number; total: number; period_id: string
    }>(
      `insert into public.bookings
         (car_id, hotel_id, room_number, start_date, end_date,
          cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '112', '2026-07-06', '2026-07-08', 'Boss', 'Booking', '+306900000042', '1988-03-04')
       returning id, ref, kind, status, created_by, days, total, period_id`,
      [f.car1, f.hotelA]))

    expect(booking.created_by).toBe(f.admin)
    expect(booking.kind).toBe('rental')
    expect(booking.status).toBe('booked')
    expect(booking.days).toBe(3)
    // The engine prices an admin's rental exactly as it prices a rep's: the
    // admin MAY type a total instead, but sending none is not a licence to
    // skip the tables.
    expect(booking.total).toBe(90)
    expect(booking.ref).toMatch(/^\d{4}-\d{4}$/)
    expect(booking.period_id).toBe(f.low)
  })

  test('the phone-booking shape — no name, no date of birth — is accepted', async () => {
    // §30's "booking confirmation": phone, room, car, dates and seats, with the
    // identity captured at pickup. The columns have always been nullable; this
    // is the first path that leaves them so on purpose.
    const booking = await db.asUser(f.admin, () => db.one<{
      id: string; created_by: string; cust_first: string | null; cust_dob: string | null
    }>(
      `insert into public.bookings
         (car_id, hotel_id, room_number, start_date, end_date, cust_phone)
       values ($1, $2, '204', '2026-07-06', '2026-07-08', '+306900000043')
       returning id, created_by, cust_first, cust_dob`,
      [f.car1, f.hotelA]))

    expect(booking.created_by).toBe(f.admin)
    expect(booking.cust_first).toBeNull()
    expect(booking.cust_dob).toBeNull()

    await db.asUser(f.admin, () => db.sql(
      `insert into public.booking_extras (booking_id, seat) values ($1, 'infant')`, [booking.id]))

    const seats = await db.sql<{ seat: string }>(
      `select seat from public.booking_extras where booking_id = $1`, [booking.id])
    expect(seats.map((s) => s.seat)).toEqual(['infant'])
  })

  test('a rep may take a phone booking with no name either', async () => {
    // The same narrow form is a rep's tool first (§30 decision 1), so the
    // grant and the policies have to accept it from a rep session too.
    const booking = await db.asUser(f.repA, () => db.one<{ created_by: string }>(
      `insert into public.bookings
         (car_id, hotel_id, room_number, start_date, end_date, cust_phone)
       values ($1, $2, '204', '2026-07-06', '2026-07-08', '+306900000044')
       returning created_by`,
      [f.car1, f.hotelA]))
    expect(booking.created_by).toBe(f.repA)
  })

  test('the double-booking guarantee still applies to the admin', async () => {
    await db.asUser(f.admin, () => db.sql(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_phone)
       values ($1, $2, '2026-07-06', '2026-07-08', '+1')`,
      [f.car1, f.hotelA]))

    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_phone)
       values ($1, $2, '2026-07-07', '2026-07-09', '+2')`,
      [f.car1, f.hotelA])))).toBe('23P01')
  })

  test('a rep still cannot author a booking as somebody else', async () => {
    // 0026 fills a null; it never overwrites. The guard's own stamping is what
    // refuses this, and it has to keep refusing it.
    await db.sql(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: f.repA, role: 'authenticated' })])
    const row = await db.one<{ created_by: string }>(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_phone, created_by)
       values ($1, $2, '2026-07-15', '2026-07-16', '+1', $3)
       returning created_by`,
      [f.car1, f.hotelA, f.repB])
    await db.sql(`select set_config('request.jwt.claims', '', false)`)

    expect(row.created_by).toBe(f.repA)
  })

  test('a service-role insert must still name an author — nothing is invented for it', async () => {
    // No auth.uid() to fall back on, so the NOT NULL stands. Seeds, fixtures
    // and the cron scripts are not quietly given an author by this trigger.
    expect(await errcode(() => db.as({ kind: 'service' }, () => db.sql(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_phone)
       values ($1, $2, '2026-07-20', '2026-07-21', '+1')`,
      [f.car1, f.hotelA])))).toBe('23502')
  })
})

describe('§30 · the admin runs the pickup flow to the end', () => {
  test('booked → out, through the eligibility gate, on a booking he made himself', async () => {
    const booking = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `insert into public.bookings
         (car_id, hotel_id, room_number, start_date, end_date, cust_phone)
       values ($1, $2, '112', '2026-07-06', '2026-07-08', '+306900000045')
       returning id`,
      [f.car1, f.hotelA]))

    // The walk-in path: the booking exists first, the licence is read second,
    // and the contract is written against a driver the gate has passed.
    await db.asUser(f.admin, () => db.sql(
      `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob,
         licence_number, licence_country, licence_issued_on, licence_expires_on)
       values ($1, true, 'Walk', 'In', '1985-01-01', 'X1', 'GR', '2010-01-01', '2030-01-01')`,
      [booking.id]))

    await db.asUser(f.admin, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [booking.id]))

    const after = await db.one<{ status: string }>(
      `select status from public.bookings where id = $1`, [booking.id])
    expect(after.status).toBe('out')
  })

  test('the eligibility hard block applies to the admin too, and is not lifted by signing', async () => {
    // §11 is a hard block on booked → out, and §30 decision 3 puts the gate in
    // front of the signature in the UI as well. Neither is weakened by the new
    // entry points: a driver too young for the category cannot be picked up,
    // whoever is holding the phone.
    const booking = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `insert into public.bookings
         (car_id, hotel_id, start_date, end_date, cust_phone)
       values ($1, $2, '2026-07-06', '2026-07-08', '+306900000046')
       returning id`,
      [f.carC, f.hotelA]))   // category C — minimum age 23 in the fixture

    await db.asUser(f.admin, () => db.sql(
      `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob,
         licence_number, licence_country, licence_issued_on, licence_expires_on)
       values ($1, true, 'Too', 'Young', '2008-01-01', 'X2', 'GR', '2025-06-01', '2035-01-01')`,
      [booking.id]))

    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [booking.id])))).toBe('IR120')
  })
})

describe('§30 · the contract picker — what each session may pick from', () => {
  // The screen lists `booked` rentals with no contract row, read through RLS
  // and nothing else. These are the reads it performs, from each session, so
  // the §8 cross-rep rule is tested where the screen actually relies on it
  // rather than assumed from the policy.
  async function unsignedFor(actor: string): Promise<string[]> {
    return db.asUser(actor, async () => {
      const bookings = await db.sql<{ id: string; ref: string }>(
        `select id, ref from public.bookings
         where kind = 'rental' and status = 'booked' order by start_date`)
      if (bookings.length === 0) return []
      const signedRows = await db.sql<{ booking_id: string }>(
        `select booking_id from public.contracts where booking_id = any($1)`,
        [bookings.map((b) => b.id)])
      const signed = new Set(signedRows.map((c) => c.booking_id))
      return bookings.filter((b) => !signed.has(b.id)).map((b) => b.ref)
    })
  }

  async function sign(bookingId: string, actor: string) {
    await db.asUser(actor, () => db.sql(
      `insert into public.contracts (booking_id, pdf_path, signature_path, signer_name)
       values ($1, 'contracts/x.pdf', 'signatures/x.png', 'Anna Guest')`, [bookingId]))
  }

  test("a rep sees their own unsigned bookings and their hotel's, never another's", async () => {
    const mine = await db.asUser(f.repA, () => db.one<{ id: string; ref: string }>(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_phone)
       values ($1, $2, '2026-07-06', '2026-07-08', '+1') returning id, ref`,
      [f.car1, f.hotelA]))
    const theirs = await db.asUser(f.repB, () => db.one<{ id: string; ref: string }>(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_phone)
       values ($1, $2, '2026-07-06', '2026-07-08', '+2') returning id, ref`,
      [f.car3, f.hotelB]))

    expect(await unsignedFor(f.repA)).toEqual([mine.ref])
    expect(await unsignedFor(f.repB)).toEqual([theirs.ref])
    // The rep who covers Hotel Alpha sees its booking too (§8's exception).
    expect(await unsignedFor(f.repCover)).toEqual([mine.ref])
    // The boss sees both, which is what makes the picker usable for him.
    expect((await unsignedFor(f.admin)).sort()).toEqual([mine.ref, theirs.ref].sort())
  })

  test('a booking drops off the list the moment its agreement is signed', async () => {
    const booking = await db.asUser(f.repA, () => db.one<{ id: string; ref: string }>(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date, cust_phone)
       values ($1, $2, '2026-07-06', '2026-07-08', '+1') returning id, ref`,
      [f.car1, f.hotelA]))

    expect(await unsignedFor(f.repA)).toEqual([booking.ref])
    await sign(booking.id, f.repA)
    expect(await unsignedFor(f.repA)).toEqual([])
  })

  test('a walk-in created and picked up in one motion leaves the list too', async () => {
    // The whole §30 decision-3 journey: booking, licence, gate, signature, out.
    const booking = await db.asUser(f.repA, () => db.one<{ id: string; ref: string }>(
      `insert into public.bookings (car_id, hotel_id, room_number, start_date, end_date, cust_phone)
       values ($1, $2, '112', '2026-07-06', '2026-07-08', '+306900000047') returning id, ref`,
      [f.car1, f.hotelA]))

    expect(await unsignedFor(f.repA)).toEqual([booking.ref])

    await db.asUser(f.repA, () => db.sql(
      `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob,
         licence_number, licence_country, licence_issued_on, licence_expires_on)
       values ($1, true, 'Walk', 'In', '1985-01-01', 'X3', 'GR', '2010-01-01', '2030-01-01')`,
      [booking.id]))
    await sign(booking.id, f.repA)
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [booking.id]))

    expect(await unsignedFor(f.repA)).toEqual([])
    const after = await db.one<{ status: string }>(
      `select status from public.bookings where id = $1`, [booking.id])
    expect(after.status).toBe('out')
  })
})
