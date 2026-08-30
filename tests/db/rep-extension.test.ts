import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// R7 · Extensions with a same-category swap (docs/01-DECISIONS.md §18), run
// end to end the way Phase 3 actually reaches them: book, pick up through R4,
// go `out`, then extend. rep-booking-screens.test.ts already covers the guard
// in isolation; what is verified here is the whole path, and the one rule the
// screen has to agree with the constraint about — a swap car must be free for
// the WHOLE rental, not just for the days being added, because one booking row
// holds one car.

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

/** Booked, driven through R4's writes, and out — the real starting state. */
async function pickedUp(rep: string, carId: string, hotelId: string, start: string, end: string) {
  const bookingId = await bookAsRep(db, rep, { carId, hotelId, start, end })

  await db.asUser(rep, () => db.sql(
    `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob,
       licence_number, licence_country, licence_issued_on, licence_expires_on)
     values ($1, true, 'Anna', 'Driver', '1985-04-02', 'GR1', 'GR', '2010-06-01', '2032-06-01')`,
    [bookingId]))
  await db.asUser(rep, () => db.sql(
    `insert into public.handovers (booking_id, kind, by_profile, fuel_eighths)
     values ($1, 'pickup', $2, 8)`, [bookingId, rep]))
  await db.asUser(rep, () => db.sql(
    `update public.bookings
        set collected_cents = 9000, pay_method = 'cash', paid = true, status = 'out'
      where id = $1`, [bookingId]))

  return bookingId
}

describe('the ordinary case: the same car is still free', () => {
  test('a full pickup → out → extend run re-prices from the ORIGINAL pickup period', async () => {
    const bookingId = await pickedUp(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10' where id = $1`, [bookingId]))

    const after = await db.one<{ days: number; total_cents: number; period_id: string; status: string }>(
      `select days, total_cents, period_id, status from public.bookings where id = $1`, [bookingId])
    expect(after.status).toBe('out')
    expect(after.days).toBe(5)
    expect(after.total_cents).toBe(14000)     // low season, category A, 5 days
    expect(after.period_id).toBe(f.low)       // the pickup date's period still prices it
  })

  test('the extension holds the car for the new days too', async () => {
    const bookingId = await pickedUp(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10' where id = $1`, [bookingId]))

    const avail = await db.asUser(f.repB, () => db.one<{ occupied_dates: string[] }>(
      `select occupied_dates from public.availability('2026-07-01', '2026-07-31') where car_id = $1`,
      [f.car1]))
    expect(avail.occupied_dates).toContain('2026-07-10')
  })

  test('the pickup handover and its damage marks survive the extension untouched', async () => {
    const bookingId = await pickedUp(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    const handover = await db.asUser(f.repA, () => db.one<{ id: string }>(
      `select id from public.handovers where booking_id = $1 and kind = 'pickup'`, [bookingId]))
    await db.asUser(f.repA, () => db.sql(
      `insert into public.damage_marks (handover_id, car_id, view, x, y, mark_type, pre_existing)
       values ($1, $2, 'left', 0.3, 0.5, 'scratch', true)`, [handover.id, f.car1]))

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10' where id = $1`, [bookingId]))

    const marks = await db.asUser(f.repA, () => db.sql(
      `select id from public.damage_marks where handover_id = $1`, [handover.id]))
    expect(marks).toHaveLength(1)
  })
})

describe('the swap case: the same car is taken later', () => {
  test('the extension is refused first, and the same-category swap goes through', async () => {
    const bookingId = await pickedUp(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')

    await db.asUser(f.repB, () => db.sql(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date,
         cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '2026-07-09', '2026-07-12', 'C', 'D', '+2', '1990-01-01')`,
      [f.car1, f.hotelB]))

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10' where id = $1`, [bookingId]))))
      .toBe('23P01')

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10', car_id = $2 where id = $1`,
      [bookingId, f.car2]))

    const after = await db.one<{ car_id: string; end_date: string; category_id: string }>(
      `select car_id, end_date, category_id from public.bookings where id = $1`, [bookingId])
    expect(after.car_id).toBe(f.car2)
    expect(after.end_date).toBe('2026-07-10')
    expect(after.category_id).toBe(f.catA)
  })

  test('THE WHOLE RENTAL MOVES: a car free only for the added days is refused', async () => {
    // This is the case R7's screen has to agree with. car2 is free across the
    // extension window (8th–10th) and busy on the 4th–6th, which is inside the
    // dates this booking already holds. One booking row holds one car, so the
    // swap moves 6th–10th onto car2 and the constraint judges all of it.
    const bookingId = await pickedUp(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')

    await db.asUser(f.repB, () => db.sql(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date,
         cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '2026-07-09', '2026-07-12', 'C', 'D', '+2', '1990-01-01')`,
      [f.car1, f.hotelB]))
    await db.asUser(f.repB, () => db.sql(
      `insert into public.bookings (car_id, hotel_id, start_date, end_date,
         cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, '2026-07-04', '2026-07-06', 'E', 'F', '+3', '1990-01-01')`,
      [f.car2, f.hotelB]))

    // availability() over the extension window alone says car2 is free…
    const narrow = await db.asUser(f.repA, () => db.one<{ occupied_dates: string[] }>(
      `select occupied_dates from public.availability('2026-07-08', '2026-07-10') where car_id = $1`,
      [f.car2]))
    expect(narrow.occupied_dates).toEqual([])

    // …and over the whole rental it does not, which is the window the screen
    // has to ask about (src/lib/availability/types.ts, swapCandidates()).
    const whole = await db.asUser(f.repA, () => db.one<{ occupied_dates: string[] }>(
      `select occupied_dates from public.availability('2026-07-06', '2026-07-10') where car_id = $1`,
      [f.car2]))
    expect(whole.occupied_dates).toContain('2026-07-06')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10', car_id = $2 where id = $1`,
      [bookingId, f.car2])))).toBe('23P01')
  })

  test('a swap out of the category is refused (IR111) even when that car is free', async () => {
    const bookingId = await pickedUp(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10', car_id = $2 where id = $1`,
      [bookingId, f.carC])))).toBe('IR111')
  })

  test('the car freed by the swap is bookable by someone else immediately', async () => {
    const bookingId = await pickedUp(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10', car_id = $2 where id = $1`,
      [bookingId, f.car2]))

    const next = await bookAsRep(db, f.repB, {
      carId: f.car1, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })
    expect(await db.one<{ status: string }>(
      `select status from public.bookings where id = $1`, [next])).toMatchObject({ status: 'booked' })
  })
})

describe('what an extension may never become', () => {
  test('shortening an in-progress rental is refused (IR110), not silently clamped', async () => {
    const bookingId = await pickedUp(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-10')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-08' where id = $1`, [bookingId]))))
      .toBe('IR110')
  })

  test('an extension is not a way back into editing the booking', async () => {
    const bookingId = await pickedUp(f.repA, f.car1, f.hotelA, '2026-07-06', '2026-07-08')

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings
          set end_date = '2026-07-10', cust_first = 'Someone', room_number = '999',
              collected_cents = 1, paid = false
        where id = $1`, [bookingId]))

    const after = await db.one<{
      end_date: string; cust_first: string; room_number: string; collected_cents: number; paid: boolean
    }>(`select end_date, cust_first, room_number, collected_cents, paid
        from public.bookings where id = $1`, [bookingId])

    expect(after.end_date).toBe('2026-07-10')        // the extension stands
    expect(after.cust_first).toBe('Anna')            // everything else reverted
    expect(after.room_number).toBe('101')
    expect(after.collected_cents).toBe(9000)
    expect(after.paid).toBe(true)
  })

  test('a rep cannot extend a rental that is neither theirs nor their hotel\'s', async () => {
    const bookingId = await pickedUp(f.repB, f.car3, f.hotelB, '2026-07-06', '2026-07-08')

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-07-10' where id = $1`, [bookingId]))

    const after = await db.one<{ end_date: string }>(
      `select end_date from public.bookings where id = $1`, [bookingId])
    expect(after.end_date).toBe('2026-07-08')   // the policy matched no row
  })

  test('an extension past the pricing period\'s own end is still priced by the PICKUP period', async () => {
    // The fixture's peak period ends on 30 Sep. Extending into October does not
    // move the rental onto another table and does not fail: the pickup date
    // decides the whole rental (docs/01-DECISIONS.md §6), and beyond seven days
    // that period's extra-day rate carries it.
    const bookingId = await pickedUp(f.repA, f.car1, f.hotelA, '2026-09-28', '2026-09-30')

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set end_date = '2026-10-05' where id = $1`, [bookingId]))

    const after = await db.one<{ days: number; period_id: string; total_cents: number }>(
      `select days, period_id, total_cents from public.bookings where id = $1`, [bookingId])
    expect(after.days).toBe(8)
    expect(after.period_id).toBe(f.peak)
    expect(after.total_cents).toBe(30000 + 4000)   // peak catA: 7-day total + 1 extra day
  })
})
