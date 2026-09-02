import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, type Fixtures } from '../helpers/fixtures'

// 0033 · only the boss makes an exception booking (docs/01-DECISIONS.md §37,
// supabase/migrations/20260902130000_admin_only_exceptions.sql).
//
// 0027 gave a rep the tick-box that gets a pick-up past the manager's window,
// and 0028 parked the result in an approval queue. This is what replaced both:
// the flag is the admin's alone, forced off on any other write by
// app.bookings_before_write(), and what it produces is an ordinary live
// booking with nothing to approve.

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

type Row = { id: string; pickup_exception: boolean; pickup_exception_reason: string | null }

const OUT_OF_WINDOW = '2026-07-06 03:00:00 Europe/Athens'
const IN_WINDOW = '2026-07-06 09:00:00 Europe/Athens'

/** One booking, by whoever, with whatever they claim about the exception. */
function book(actor: string, opts: {
  pickup?: string
  exception?: boolean
  reason?: string | null
  carId?: string
} = {}) {
  return db.asUser(actor, () => db.one<Row>(
    `insert into public.bookings
       (car_id, hotel_id, room_number, start_date, end_date,
        cust_first, cust_last, cust_phone, cust_dob, pickup_at, dropoff_at,
        pickup_exception, pickup_exception_reason)
     values ($1, $2, '101', '2026-07-06', '2026-07-08', 'Anna', 'Visitor',
             '+306900000000', '1990-01-01', $3, '2026-07-08 19:00:00 Europe/Athens', $4, $5)
     returning id, pickup_exception, pickup_exception_reason`,
    [
      opts.carId ?? f.car1, f.hotelA,
      opts.pickup ?? IN_WINDOW,
      opts.exception ?? false,
      opts.reason === undefined ? null : opts.reason,
    ]))
}

describe('the flag is the boss\'s alone', () => {
  test('a rep who ticks it is ignored, not obeyed', async () => {
    const b = await book(f.repA, { exception: true, reason: 'trying it on' })
    expect(b.pickup_exception).toBe(false)
    expect(b.pickup_exception_reason).toBeNull()
  })

  test('so an out-of-window pick-up is refused however the rep flags it', async () => {
    // The window guard runs after the guard that drops the claim, so what the
    // rep meets is IR116 — the pick-up is out of hours — rather than anything
    // about permissions.
    expect(await errcode(() => book(f.repA, {
      pickup: OUT_OF_WINDOW, exception: true, reason: 'guest landing on a red-eye',
    }))).toBe('IR116')
  })

  test('the boss books the same thing and it goes through', async () => {
    const b = await book(f.admin, {
      pickup: OUT_OF_WINDOW, exception: true, reason: 'guest landing on a red-eye',
    })
    expect(b.pickup_exception).toBe(true)
    expect(b.pickup_exception_reason).toBe('guest landing on a red-eye')
  })

  test('the boss still needs a reason for it', async () => {
    expect(await errcode(() => book(f.admin, {
      pickup: OUT_OF_WINDOW, exception: true, reason: null,
    }))).toBe('23514')
  })

  test('and is refused the same as anyone if he does not flag it at all', async () => {
    expect(await errcode(() => book(f.admin, { pickup: OUT_OF_WINDOW })))
      .toBe('IR116')
  })
})

describe('what a rep may do to a booking that already exists', () => {
  test('ticking the box afterwards changes nothing', async () => {
    const b = await book(f.repA)
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings
          set pickup_exception = true, pickup_exception_reason = 'after the fact'
        where id = $1`, [b.id]))

    const row = await db.one<Row>(
      `select id, pickup_exception, pickup_exception_reason from public.bookings where id = $1`,
      [b.id])
    expect(row.pickup_exception).toBe(false)
    expect(row.pickup_exception_reason).toBeNull()
  })

  test('and neither does moving the pick-up out of hours with it', async () => {
    const b = await book(f.repA)
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings
          set pickup_exception = true, pickup_exception_reason = 'after the fact',
              pickup_at = $2
        where id = $1`, [b.id, OUT_OF_WINDOW])))).toBe('IR116')
  })

  test('unticking the boss\'s exception is reverted, not obeyed', async () => {
    const b = await book(f.admin, {
      pickup: OUT_OF_WINDOW, exception: true, reason: 'guest landing on a red-eye',
    })
    // An ordinary rep edit — the room number — carrying a false claim with it.
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set room_number = '204', pickup_exception = false
        where id = $1`, [b.id]))

    const row = await db.one<Row & { room_number: string }>(
      `select id, room_number, pickup_exception, pickup_exception_reason
         from public.bookings where id = $1`, [b.id])
    expect(row.room_number).toBe('204')
    expect(row.pickup_exception).toBe(true)
    expect(row.pickup_exception_reason).toBe('guest landing on a red-eye')
  })
})

describe('an exception booking is live the moment it is made', () => {
  test('it is on the rep\'s day like any other booking', async () => {
    // rep_day_movements() is called from the push sender on the service role
    // (src/lib/push/notify.ts), never directly by a rep session.
    const b = await book(f.admin, {
      pickup: OUT_OF_WINDOW, exception: true, reason: 'guest landing on a red-eye',
    })
    const rows = await db.as({ kind: 'service' }, () => db.sql<{ booking_id: string }>(
      `select booking_id from public.rep_day_movements($1, '2026-07-06')`, [f.repA]))
    expect(rows.map((r) => r.booking_id)).toContain(b.id)
  })

  test('nothing about the exception stands between it and pickup', async () => {
    const b = await book(f.admin, {
      pickup: OUT_OF_WINDOW, exception: true, reason: 'guest landing on a red-eye',
    })
    // IR121 is the eligibility gate — no driver was ever recorded. That it is
    // what refuses the transition is the point: the approval block (IR123)
    // that used to come first is gone.
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [b.id])))).toBe('IR121')
  })
})

describe('the approval machinery is gone', () => {
  test('the queue and both its RPCs no longer exist', async () => {
    for (const call of [
      `select public.admin_pending_exception_bookings()`,
      `select public.admin_approve_exception_booking('00000000-0000-4000-8000-000000000000')`,
      `select public.admin_deny_exception_booking('00000000-0000-4000-8000-000000000000')`,
    ]) {
      expect(await errcode(() => db.asUser(f.admin, () => db.sql(call)))).toBe('42883')
    }
  })

  test('and neither does the column they moved', async () => {
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select exception_status from public.bookings`)))).toBe('42703')
  })
})
