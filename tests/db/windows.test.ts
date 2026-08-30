import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, type Fixtures } from '../helpers/fixtures'

// The default pick-up and drop-off windows (docs/01-DECISIONS.md §5), set on
// A10 and applied by supabase/migrations/20260830170000_windows.sql.
//
// "These are defaults, overridable per booking. The override is recorded." The
// second sentence is the one with teeth: `window_override` sits in the rep's
// own INSERT and UPDATE grant, so before this migration a rep could book a
// 03:00 pick-up and mark it ordinary, or stamp an override on a routine one.
// A recorded fact the caller supplies is not recorded, it is claimed.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.sql(`delete from public.bookings`)
  await db.sql(
    `update public.app_settings
        set pickup_window = '08:30-11:30', dropoff_window = '18:00-21:00' where id = 1`)
})

/** A booking with times, made the way a rep makes one. */
async function book(opts: {
  pickup?: string | null
  dropoff?: string | null
  claimOverride?: boolean
} = {}) {
  return db.asUser(f.repA, () => db.one<{ id: string; window_override: boolean }>(
    `insert into public.bookings
       (car_id, hotel_id, room_number, start_date, end_date,
        cust_first, cust_last, cust_phone, cust_dob, pickup_at, dropoff_at, window_override)
     values ($1, $2, '101', '2026-07-06', '2026-07-08', 'Anna', 'Visitor',
             '+306900000000', '1990-01-01', $3, $4, $5)
     returning id, window_override`,
    [
      f.car1, f.hotelA,
      opts.pickup === undefined ? '2026-07-06 09:00:00 Europe/Athens' : opts.pickup,
      opts.dropoff === undefined ? '2026-07-08 19:00:00 Europe/Athens' : opts.dropoff,
      opts.claimOverride ?? false,
    ]))
}

describe('the times a booking carries', () => {
  test('a pick-up inside the window is not an override', async () => {
    expect((await book()).window_override).toBe(false)
  })

  test('a pick-up before the window opens is', async () => {
    const b = await book({ pickup: '2026-07-06 07:15:00 Europe/Athens' })
    expect(b.window_override).toBe(true)
  })

  test('a drop-off after the window closes is too', async () => {
    const b = await book({ dropoff: '2026-07-08 23:30:00 Europe/Athens' })
    expect(b.window_override).toBe(true)
  })

  test('a booking with no times at all is not an override', async () => {
    // Every booking made before R3 collected times has nulls here, and none of
    // them is retrospectively out of hours.
    const b = await book({ pickup: null, dropoff: null })
    expect(b.window_override).toBe(false)
  })

  test('the time is stored as the instant that clock time is in Athens', async () => {
    const b = await book({ pickup: '2026-07-06 09:00:00 Europe/Athens' })
    const row = await db.one<{ local: string }>(
      `select to_char(pickup_at at time zone 'Europe/Athens', 'YYYY-MM-DD HH24:MI') as local
       from public.bookings where id = $1`, [b.id])
    expect(row.local).toBe('2026-07-06 09:00')
  })
})

describe('the override is derived, never accepted', () => {
  test('a rep claiming an override on an ordinary booking does not get one', async () => {
    const b = await book({ claimOverride: true })
    expect(b.window_override).toBe(false)
  })

  test('a rep claiming NO override on a 03:00 pick-up still gets one', async () => {
    const b = await book({
      pickup: '2026-07-06 03:00:00 Europe/Athens', claimOverride: false,
    })
    expect(b.window_override).toBe(true)
  })

  test('the admin cannot hand-set it either — it is a fact about the times', async () => {
    const b = await book()
    await db.asUser(f.admin, () => db.sql(
      `update public.bookings set window_override = true where id = $1`, [b.id]))

    const after = await db.one<{ window_override: boolean }>(
      `select window_override from public.bookings where id = $1`, [b.id])
    expect(after.window_override).toBe(false)
  })

  test('moving the time on an existing booking re-decides it', async () => {
    const b = await book()
    expect(b.window_override).toBe(false)

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set pickup_at = $2 where id = $1`,
      [b.id, '2026-07-06 06:00:00 Europe/Athens']))

    const after = await db.one<{ window_override: boolean }>(
      `select window_override from public.bookings where id = $1`, [b.id])
    expect(after.window_override).toBe(true)
  })
})

describe('the windows are the admin\'s', () => {
  test('widening them makes a previously out-of-hours time ordinary', async () => {
    const early = await book({ pickup: '2026-07-06 07:15:00 Europe/Athens' })
    expect(early.window_override).toBe(true)

    await db.asUser(f.admin, () => db.sql(
      `update public.app_settings set pickup_window = '07:00-12:00' where id = 1`))

    // Only on the next write: this is a stamp on the booking, not a live join,
    // so what was recorded at the time stays recorded.
    const untouched = await db.one<{ window_override: boolean }>(
      `select window_override from public.bookings where id = $1`, [early.id])
    expect(untouched.window_override).toBe(true)

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set room_number = '202' where id = $1`, [early.id]))
    const after = await db.one<{ window_override: boolean }>(
      `select window_override from public.bookings where id = $1`, [early.id])
    expect(after.window_override).toBe(false)
  })

  test('a malformed window is refused by the column, not stored', async () => {
    for (const bad of ['08:30', '0830-1130', 'morning', '08:30-11:30-14:00']) {
      expect(await errcode(() => db.asUser(f.admin, () => db.sql(
        `update public.app_settings set pickup_window = $1 where id = 1`, [bad]))), bad)
        .toBe('23514')
    }
  })

  test('a rep cannot change them', async () => {
    await db.asUser(f.repA, () => db.sql(
      `update public.app_settings set pickup_window = '00:00-23:59' where id = 1`))
    const row = await db.one<{ pickup_window: string }>(
      `select pickup_window from public.app_settings`)
    expect(row.pickup_window).toBe('08:30-11:30')
  })
})

describe('what R3 pre-fills with', () => {
  test('booking_windows() gives any signed-in rep the four times', async () => {
    const w = await db.asUser(f.repA, () => db.one<{
      pickup_from: string; pickup_to: string; dropoff_from: string; dropoff_to: string
    }>(`select pickup_from, pickup_to, dropoff_from, dropoff_to from public.booking_windows()`))

    expect(w).toEqual({
      pickup_from: '08:30', pickup_to: '11:30',
      dropoff_from: '18:00', dropoff_to: '21:00',
    })
  })

  test('and a signed-out caller nothing', async () => {
    expect(await errcode(() => db.as({ kind: 'anon' }, () => db.sql(
      `select pickup_from from public.booking_windows()`)))).toBe('42501')
  })
})
