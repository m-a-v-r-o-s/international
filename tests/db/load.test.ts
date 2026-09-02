import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { TestDb } from '../helpers/db'
import { seed, type Fixtures } from '../helpers/fixtures'

// docs/05-BUILD-PLAN.md, Phase 5: "Load test the movements sheet at 200 rows
// and the availability screen at 100 cars." Risks table: "Peak-season load
// (200 movements/day) → indexed queries, load-tested in Phase 5, well before
// May."
//
// WHAT THIS TESTS AND WHAT IT DOES NOT. It is a load test of the DATA LAYER:
// the queries A1 and R2 actually issue, against a real Postgres holding the
// real volume, through the real policies. It says nothing about how long the
// HTML takes to reach a mid-range Android on 4G — that needs a deployed URL
// and a device, and is recorded as still outstanding in
// docs/06-IMPLEMENTATION-NOTES.md.
//
// The budgets below are deliberately generous and are there to catch a
// COLLAPSE — a missing index, an accidental cross join, an O(cars x days)
// walk — not to police milliseconds on a laptop that may be building
// something else at the time. A regression that matters here shows up as
// seconds, not as a few milliseconds either way.

let db: TestDb
let f: Fixtures

/** The real fleet size (docs/01-DECISIONS.md: ~100 cars). */
const FLEET = 100

/**
 * Peak season, per the risks table. Note what that figure implies: a day is
 * inclusive and the exclusion constraint gives one car at most one hold on a
 * date, so a car returning on the 15th and a car being picked up on the 15th
 * are necessarily DIFFERENT cars — 200 movements on one day is not reachable
 * with a hundred-car fleet at all. To produce the 200 rows the build plan asks
 * the sheet to be tested at, the fixture loads twice the real fleet, which
 * makes every budget below conservative rather than optimistic.
 */
const MOVEMENTS = 200
const LOAD_CARS = MOVEMENTS

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)

  // ── A hundred cars, spread over the seeded models ────────────────────────
  await db.sql(
    `insert into public.cars (plate, model_id, year, colour)
     select 'LOAD-' || lpad(i::text, 4, '0'),
            (array[$1::uuid, $2::uuid, $3::uuid])[1 + (i % 3)],
            2024, 'white'
     from generate_series(1, $4) as i`,
    [f.modelA, f.modelB, f.modelC, LOAD_CARS])

  // ── 200 movements on one day ─────────────────────────────────────────────
  // 100 rentals starting that day and 100 ending it, which is what A1 shows:
  // pickups then returns. Every one is a real row through the guard trigger
  // and the exclusion constraint, priced by the engine, so this is the volume
  // the screen will really meet rather than a fixture shortcut.
  const cars = await db.sql<{ id: string }>(
    `select id from public.cars where plate like 'LOAD-%' order by plate`)

  for (let i = 0; i < MOVEMENTS / 2; i++) {
    const starting = cars[i]!.id
    const ending = cars[i + MOVEMENTS / 2]!.id
    await db.asUser(f.repA, () => db.sql(
      `insert into public.bookings
         (car_id, hotel_id, room_number, start_date, end_date,
          cust_first, cust_last, cust_phone, cust_dob, pickup_at)
       values ($1, $2, '101', '2026-07-15', '2026-07-18', 'Guest', $3,
               '+306900000000', '1990-01-01', '2026-07-15 09:00:00 Europe/Athens')`,
      [starting, f.hotelA, `Pickup${i}`]))
    // A return on the sheet is a rental that is already OUT, so these go all
    // the way through the pickup the same way a real one does: a driver who
    // passes the eligibility rules, then booked → out. Anything less would be
    // loading rows the screen does not actually select.
    const returning = await db.asUser(f.repA, () => db.one<{ id: string }>(
      `insert into public.bookings
         (car_id, hotel_id, room_number, start_date, end_date,
          cust_first, cust_last, cust_phone, cust_dob, dropoff_at)
       values ($1, $2, '102', '2026-07-12', '2026-07-15', 'Guest', $3,
               '+306900000000', '1990-01-01', '2026-07-15 19:00:00 Europe/Athens')
       returning id`,
      [ending, f.hotelA, `Return${i}`]))

    await db.asUser(f.repA, () => db.sql(
      `insert into public.booking_drivers
         (booking_id, is_main, first_name, last_name, dob, licence_number,
          licence_country, licence_issued_on, licence_expires_on)
       values ($1, true, 'Guest', $2, '1985-01-01', 'LOAD-LIC', 'GR',
               '2010-01-01', '2032-01-01')`,
      [returning.id, `Return${i}`]))

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [returning.id]))
  }
}, 300_000)

afterAll(async () => { await db?.close() })

/**
 * The measurement is also the output: a load test whose numbers nobody ever
 * sees is an assertion, not a measurement. Each one prints, so a CI run leaves
 * a record of how the queries behaved on that machine on that day and a
 * gradual drift is visible before it becomes a failure.
 */
async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = performance.now()
  const value = await fn()
  const ms = performance.now() - started
  console.log(`    ${label.padEnd(46)} ${ms.toFixed(0).padStart(5)} ms`)
  return { ms, value }
}

describe('the fleet is really there', () => {
  test('the fleet and 200 movements on the day', async () => {
    const cars = await db.one<{ n: string }>(
      `select count(*) as n from public.cars where archived_at is null`)
    expect(Number(cars.n)).toBeGreaterThanOrEqual(FLEET)
    expect(Number(cars.n)).toBeGreaterThanOrEqual(LOAD_CARS)

    const movements = await db.one<{ n: string }>(
      `select count(*) as n from public.bookings
        where start_date = '2026-07-15' or end_date = '2026-07-15'`)
    expect(Number(movements.n)).toBe(MOVEMENTS)
  })
})

describe('R2 · availability at 100 cars', () => {
  test('a fortnight over the whole fleet, from a rep session', async () => {
    const { ms, value } = await timed('availability · 14 days, whole fleet',
      () => db.asUser(f.repA, () => db.sql<{
        car_id: string; occupied_dates: string[]
      }>(`select car_id, occupied_dates from public.availability('2026-07-08', '2026-07-21')`)))

    expect(value.length).toBeGreaterThanOrEqual(FLEET)
    // Every car answers, and the ones with a hold in the window say which days.
    expect(value.some((r) => r.occupied_dates.length > 0)).toBe(true)
    expect(ms).toBeLessThan(2000)
  })

  test('the largest range the engine permits does not fall over', async () => {
    // 366 days is the cap availability() enforces (IR105), so this is the
    // worst request a rep can make: the whole fleet for a whole year.
    const { ms, value } = await timed('availability · 365 days, whole fleet',
      () => db.asUser(f.repA, () => db.sql(
        `select car_id from public.availability('2026-01-01', '2026-12-31')`)))

    expect(value.length).toBeGreaterThanOrEqual(FLEET)
    expect(ms).toBeLessThan(5000)
  })

  test('a single day is not paying for the fortnight', async () => {
    const { ms } = await timed('availability · 1 day, whole fleet',
      () => db.asUser(f.repA, () => db.sql(
        `select car_id from public.availability('2026-07-15', '2026-07-15')`)))
    expect(ms).toBeLessThan(2000)
  })
})

describe('A1 · the movements sheet at 200 rows', () => {
  const COLUMNS =
    'id, ref, status, car_id, hotel_id, room_number, start_date, end_date, ' +
    'pickup_at, dropoff_at, cust_first, cust_last, created_by'

  test('both halves of the boss\'s morning screen, as the screen asks for them', async () => {
    const { ms, value } = await timed('movements · 200 rows', () => db.asUser(f.admin, async () => {
      const pickups = await db.sql(
        `select ${COLUMNS} from public.bookings
          where kind = 'rental' and start_date = '2026-07-15'
            and status in ('booked','out')`)
      const returns = await db.sql(
        `select ${COLUMNS} from public.bookings
          where kind = 'rental' and end_date = '2026-07-15'
            and status in ('out','returned')`)
      return { pickups, returns }
    }))

    expect(value.pickups).toHaveLength(MOVEMENTS / 2)
    expect(value.returns).toHaveLength(MOVEMENTS / 2)
    expect(ms).toBeLessThan(2000)
  })

  test('and the four lookups it hangs off them', async () => {
    // A1 resolves plates, models, hotels and rep names by id rather than
    // joining, so this is the shape of the real page load at full volume.
    const { ms } = await timed('movements · the four id lookups',
      () => db.asUser(f.admin, async () => {
      const rows = await db.sql<{ car_id: string; created_by: string }>(
        `select car_id, created_by from public.bookings
          where start_date = '2026-07-15' or end_date = '2026-07-15'`)
      const carIds = [...new Set(rows.map((r) => r.car_id))]
      const repIds = [...new Set(rows.map((r) => r.created_by))]

      const cars = await db.sql<{ model_id: string }>(
        `select id, plate, model_id from public.cars where id = any($1::uuid[])`, [carIds])
      await db.sql(
        `select id, make, model from public.car_models where id = any($1::uuid[])`,
        [[...new Set(cars.map((c) => c.model_id))]])
      await db.sql(`select id, name from public.hotels where id = any($1::uuid[])`, [[f.hotelA]])
      await db.sql(
        `select id, full_name from public.profiles where id = any($1::uuid[])`, [repIds])
    }))

    expect(ms).toBeLessThan(2000)
  })
})

describe('the rep screens do not degrade with the fleet', () => {
  test('R6 · a rep\'s own bookings at 200 rows', async () => {
    const { ms, value } = await timed('my bookings · newest 50', () => db.asUser(f.repA, () => db.sql(
      `select id, ref, status, car_id, start_date, end_date, total
       from public.bookings
       where kind = 'rental'
       order by start_date desc
       limit 50`)))

    expect(value).toHaveLength(50)
    expect(ms).toBeLessThan(2000)
  })

  test('R1 · today\'s cash in hand is still one cheap answer', async () => {
    const { ms } = await timed('cash in hand', () => db.asUser(f.repA, () => db.sql(
      `select public.my_cash_in_hand()`)))
    expect(ms).toBeLessThan(1000)
  })

  test('the isolation predicate is still what filters, at volume', async () => {
    // The point of the fleet being loaded: rep B is at another hotel and
    // created none of these, so 200 movements are 0 rows for them. If the
    // policy ever stopped filtering, this is where it would show.
    const { value } = await timed('isolation · another rep sees none of it',
      () => db.asUser(f.repB, () => db.sql(
        `select id from public.bookings where start_date = '2026-07-15'`)))
    expect(value).toHaveLength(0)
  })
})
