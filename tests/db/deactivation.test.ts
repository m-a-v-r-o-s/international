import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// Deactivating an account actually deactivates it
// (supabase/migrations/20260830150000_deactivation.sql).
//
// Found while building A8, and found there because "deactivate, never delete"
// (docs/04-SCREENS.md A8) is that screen's whole answer to a rep leaving, so
// it had to be tested — and it did not hold.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

const canSee = async (rep: string, bookingId: string) =>
  (await db.asUser(rep, () => db.sql(
    `select id from public.bookings where id = $1`, [bookingId]))).length

// supabase/migrations/20260830150000_deactivation.sql.
//
// A JWT issued before an account was deactivated stays valid until it expires
// — Supabase is not told, and there is no way to tell it — so "deactivated"
// has to mean something to Postgres and not only to the app boundary. Before
// this migration it did not: a dismissed rep holding their own access token
// and the anon key could read a colleague's guests and their licence numbers
// straight off PostgREST, and could still UPDATE a live booking.
//
// The threat model names exactly this caller: "a logged-in rep with a valid
// session and a browser dev-tools window" (docs/03-SECURITY.md).
describe('a deactivated rep whose token has not expired yet', () => {
  let booking: string
  let colleague: string

  beforeEach(async () => {
    await db.sql(`delete from public.bookings`)
    booking = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    colleague = await bookAsRep(db, f.repCover, {
      carId: f.car2, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await db.asUser(f.repA, () => db.sql(
      `insert into public.booking_drivers
         (booking_id, is_main, first_name, last_name, dob, licence_number,
          licence_country, licence_issued_on, licence_expires_on)
       values ($1, true, 'Anna', 'Visitor', '1985-01-01', 'LIC-12345', 'GR',
               '2010-01-01', '2032-01-01')`, [booking]))
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_user_active($1, false)`, [f.repA]))
  })

  afterEach(async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_user_active($1, true)`, [f.repA]))
  })

  test('reads nothing — not their own booking, and not the hotel\'s', async () => {
    expect(await canSee(f.repA, booking)).toBe(0)
    expect(await canSee(f.repA, colleague)).toBe(0)
  })

  test('reaches no licence number on any booking they could see yesterday', async () => {
    const drivers = await db.asUser(f.repA, () => db.sql(
      `select licence_number from public.booking_drivers`))
    expect(drivers).toHaveLength(0)
  })

  test('carries no hotel with them', async () => {
    const { h } = await db.asUser(f.repA, () => db.one<{ h: string[] }>(
      `select app.my_hotel_ids() as h`))
    expect(h).toEqual([])
  })

  test('cannot change a live booking — this one used to return rows=1', async () => {
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set room_number = 'TAMPERED' where id = $1`, [booking]))
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'cancelled' where id = $1`, [booking]))

    const after = await db.one<{ room_number: string; status: string }>(
      `select room_number, status from public.bookings where id = $1`, [booking])
    expect(after.room_number).toBe('101')
    expect(after.status).toBe('booked')
  })

  test('cannot create one either — that half was already safe (IR001)', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date)
       values ($1, $2, '2026-09-01', '2026-09-03')`, [f.car3, f.hotelA])))).toBe('IR001')
  })

  test('reaches nothing in the private bucket — the object policies ask the same question', async () => {
    await db.as({ kind: 'service' }, () => db.sql(
      `insert into storage.objects (bucket_id, name, metadata)
       values ('booking-files', $1, '{}'::jsonb)`, [`${booking}/licences/front.jpg`]))

    const seen = await db.asUser(f.repA, () => db.sql(
      `select name from storage.objects where bucket_id = 'booking-files'`))
    expect(seen).toHaveLength(0)

    await db.sql(`delete from storage.objects`)
  })

  test('sees none of their own cash, and cannot record a receipt', async () => {
    expect(await db.asUser(f.repA, () => db.sql(
      `select id from public.cash_handovers`))).toHaveLength(0)
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.cash_handovers (rep_id, amount) values ($1, 50)`,
      [f.repA])))).toBe('42501')
  })

  test('and the boss still sees all of it', async () => {
    expect(await canSee(f.admin, booking)).toBe(1)
    expect(await db.asUser(f.admin, () => db.sql(
      `select licence_number from public.booking_drivers`))).toHaveLength(1)
  })
})
