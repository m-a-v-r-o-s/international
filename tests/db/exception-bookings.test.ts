import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, type Fixtures } from '../helpers/fixtures'

// 0028 · exception bookings wait for the boss (docs/01-DECISIONS.md §33,
// supabase/migrations/20260901150000_booking_exception_approval.sql). The
// pickup-window exception flag already existed (0027, tests/db/windows.test.ts);
// this is what changed about it — it now starts a booking 'pending' rather
// than live, and only the two admin RPCs below move it out of that state.

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

/** An exception booking, made the way a rep makes one: out-of-window, flagged, with a reason. */
async function bookException(rep: string, opts: { carId?: string; start?: string; end?: string } = {}) {
  return db.asUser(rep, () => db.one<{ id: string; exception_status: string | null; status: string }>(
    `insert into public.bookings
       (car_id, hotel_id, room_number, start_date, end_date,
        cust_first, cust_last, cust_phone, cust_dob, pickup_at, dropoff_at,
        pickup_exception, pickup_exception_reason)
     values ($1, $2, '101', $3, $4, 'Anna', 'Visitor', '+306900000000', '1990-01-01',
             $5, '2026-07-08 19:00:00 Europe/Athens', true, 'guest landing on a red-eye')
     returning id, exception_status, status`,
    [
      opts.carId ?? f.car1, f.hotelA,
      opts.start ?? '2026-07-06', opts.end ?? '2026-07-08',
      `${opts.start ?? '2026-07-06'} 03:00:00 Europe/Athens`,
    ]))
}

/** An ordinary, in-window booking. */
async function bookOrdinary(rep: string, opts: { carId?: string; start?: string; end?: string } = {}) {
  return db.asUser(rep, () => db.one<{ id: string; exception_status: string | null; status: string }>(
    `insert into public.bookings
       (car_id, hotel_id, room_number, start_date, end_date,
        cust_first, cust_last, cust_phone, cust_dob, pickup_at, dropoff_at)
     values ($1, $2, '101', $3, $4, 'Anna', 'Visitor', '+306900000000', '1990-01-01',
             $5, $6)
     returning id, exception_status, status`,
    [
      opts.carId ?? f.car1, f.hotelA,
      opts.start ?? '2026-07-06', opts.end ?? '2026-07-08',
      `${opts.start ?? '2026-07-06'} 09:00:00 Europe/Athens`,
      `${opts.end ?? '2026-07-08'} 19:00:00 Europe/Athens`,
    ]))
}

describe('the state an exception booking starts in', () => {
  test('an ordinary booking never gets one', async () => {
    const b = await bookOrdinary(f.repA)
    expect(b.exception_status).toBeNull()
  })

  test('an exception booking starts pending', async () => {
    const b = await bookException(f.repA)
    expect(b.exception_status).toBe('pending')
    // It is written as a completely ordinary 'booked' row otherwise — the
    // pending-ness is the one thing that marks it out.
    expect(b.status).toBe('booked')
  })

  test('a rep cannot claim any other value for it — there is no grant on the column', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.bookings
         (car_id, hotel_id, room_number, start_date, end_date,
          cust_first, cust_last, cust_phone, cust_dob, pickup_at,
          pickup_exception, pickup_exception_reason, exception_status)
       values ($1, $2, '101', '2026-07-06', '2026-07-08', 'Anna', 'Visitor',
               '+306900000000', '1990-01-01', '2026-07-06 03:00:00 Europe/Athens',
               true, 'testing', 'approved')`,
      [f.car1, f.hotelA])))).toBe('42501')
  })

  test('re-ticking the box on an already-decided booking restarts it at pending, not whatever it was', async () => {
    const b = await bookException(f.repA)
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_approve_exception_booking($1)`, [b.id]))

    // Untick it (ordinary), then re-tick it — the approval does not survive
    // a rep turning the flag off and back on.
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set pickup_exception = false, pickup_at = $2 where id = $1`,
      [b.id, '2026-07-06 09:00:00 Europe/Athens']))
    let row = await db.one<{ exception_status: string | null }>(
      `select exception_status from public.bookings where id = $1`, [b.id])
    expect(row.exception_status).toBeNull()

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings
          set pickup_exception = true, pickup_exception_reason = 'again',
              pickup_at = $2
        where id = $1`,
      [b.id, '2026-07-06 03:00:00 Europe/Athens']))
    row = await db.one<{ exception_status: string | null }>(
      `select exception_status from public.bookings where id = $1`, [b.id])
    expect(row.exception_status).toBe('pending')
  })
})

describe('the car is held regardless', () => {
  test('a pending exception booking still blocks a second booking on the same car and dates', async () => {
    await bookException(f.repA)
    expect(await errcode(() => bookOrdinary(f.repB, { carId: f.car1 }))).toBe('23P01')
  })
})

describe('it cannot be picked up until approved', () => {
  test('starting pickup on a pending exception booking is refused', async () => {
    const b = await bookException(f.repA)
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [b.id])))).toBe('IR123')
  })

  test('approving it clears the way', async () => {
    const b = await bookException(f.repA)
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_approve_exception_booking($1)`, [b.id]))

    const row = await db.one<{ exception_status: string; status: string }>(
      `select exception_status, status from public.bookings where id = $1`, [b.id])
    expect(row.exception_status).toBe('approved')
    expect(row.status).toBe('booked')

    // The eligibility gate still applies — no driver was ever recorded, so
    // this now fails on IR121, not IR123. That is the point: approval clears
    // ONE gate, not every gate a pickup has.
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [b.id])))).toBe('IR121')
  })
})

describe('the two ways out of pending', () => {
  test('a rep cannot approve or deny', async () => {
    const b = await bookException(f.repA)
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.admin_approve_exception_booking($1)`, [b.id])))).toBe('IR001')
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.admin_deny_exception_booking($1)`, [b.id])))).toBe('IR001')
  })

  test('denying cancels the booking and frees the car back up', async () => {
    const b = await bookException(f.repA)
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_deny_exception_booking($1)`, [b.id]))

    const row = await db.one<{ exception_status: string; status: string }>(
      `select exception_status, status from public.bookings where id = $1`, [b.id])
    expect(row.exception_status).toBe('denied')
    expect(row.status).toBe('cancelled')

    // Cancelled falls outside the exclusion constraint's predicate — the same
    // car, same dates, now succeeds for a different rep.
    await expect(bookOrdinary(f.repB, { carId: f.car1 })).resolves.toBeTruthy()
  })

  test('approving or denying twice is refused — there is nothing pending left', async () => {
    const b = await bookException(f.repA)
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_approve_exception_booking($1)`, [b.id]))
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select public.admin_approve_exception_booking($1)`, [b.id])))).toBe('IR112')
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select public.admin_deny_exception_booking($1)`, [b.id])))).toBe('IR112')
  })

  test('a random id is refused the same way', async () => {
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select public.admin_approve_exception_booking('00000000-0000-4000-8000-000000000000')`))))
      .toBe('IR112')
  })
})

describe('what the rest of the day does not see', () => {
  // rep_day_movements() is called from the push sender on the service role
  // (src/lib/push/notify.ts), never directly by a rep session — same identity
  // the real cron uses.
  test('rep_day_movements excludes a pending pickup but includes an approved one', async () => {
    const b = await bookException(f.repA, { start: '2026-07-06', end: '2026-07-08' })

    const pending = await db.as({ kind: 'service' }, () => db.sql<{ booking_id: string }>(
      `select booking_id from public.rep_day_movements($1, '2026-07-06')`, [f.repA]))
    expect(pending.map((r) => r.booking_id)).not.toContain(b.id)

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_approve_exception_booking($1)`, [b.id]))

    const approved = await db.as({ kind: 'service' }, () => db.sql<{ booking_id: string }>(
      `select booking_id from public.rep_day_movements($1, '2026-07-06')`, [f.repA]))
    expect(approved.map((r) => r.booking_id)).toContain(b.id)
  })

  test('an ordinary booking is unaffected', async () => {
    const b = await bookOrdinary(f.repA, { start: '2026-07-06', end: '2026-07-08' })
    const rows = await db.as({ kind: 'service' }, () => db.sql<{ booking_id: string }>(
      `select booking_id from public.rep_day_movements($1, '2026-07-06')`, [f.repA]))
    expect(rows.map((r) => r.booking_id)).toContain(b.id)
  })
})

describe('the boss\'s queue', () => {
  test('lists a pending exception booking with its reason, and nothing else', async () => {
    const pending = await bookException(f.repA)
    const ordinary = await bookOrdinary(f.repA, { carId: f.car2 })

    const rows = await db.asUser(f.admin, () => db.sql<{
      booking_id: string; reason: string | null
    }>(`select booking_id, reason from public.admin_pending_exception_bookings()`))

    const ids = rows.map((r) => r.booking_id)
    expect(ids).toContain(pending.id)
    expect(ids).not.toContain(ordinary.id)
    expect(rows.find((r) => r.booking_id === pending.id)?.reason).toBe('guest landing on a red-eye')
  })

  test('drops off the queue once approved', async () => {
    const b = await bookException(f.repA)
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_approve_exception_booking($1)`, [b.id]))

    const rows = await db.asUser(f.admin, () => db.sql<{ booking_id: string }>(
      `select booking_id from public.admin_pending_exception_bookings()`))
    expect(rows.map((r) => r.booking_id)).not.toContain(b.id)
  })

  test('a rep cannot read it', async () => {
    await bookException(f.repA)
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select * from public.admin_pending_exception_bookings()`)))).toBe('IR001')
  })
})
