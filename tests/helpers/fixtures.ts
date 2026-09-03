import type { TestDb } from './db'

export type Fixtures = Awaited<ReturnType<typeof seed>>

/**
 * A miniature of the real business: two hotels, an admin, three reps (one of
 * whom covers the first hotel alongside its own rep), three categories with
 * different age minimums, a handful of cars and two pricing periods.
 *
 * The numbers are invented, and deliberately so — the client's real categories,
 * fleet and price tables have not arrived yet (docs/01-DECISIONS.md §28). The
 * engines are what is under test, not the tariff.
 */
export async function seed(db: TestDb) {
  const admin = await createUser(db, 'boss@example.com', 'admin', 'The Boss')
  const repA = await createUser(db, 'rep-a@example.com', 'rep', 'Rep A')
  const repB = await createUser(db, 'rep-b@example.com', 'rep', 'Rep B')
  const repCover = await createUser(db, 'rep-cover@example.com', 'rep', 'Rep Cover')
  const inactive = await createUser(db, 'gone@example.com', 'rep', 'Former Rep')
  await db.sql(`update public.profiles set active = false where id = $1`, [inactive])

  const hotelA = await insertReturningId(db,
    `insert into public.hotels (name, area) values ('Hotel Alpha', 'Rethymno') returning id`)
  const hotelB = await insertReturningId(db,
    `insert into public.hotels (name, area) values ('Hotel Beta', 'Chania') returning id`)

  // Rep A is stationed at Hotel Alpha; Rep Cover covers it too, so both must be
  // able to see its bookings. Rep B is at Hotel Beta and must see none of them.
  await db.sql(
    `insert into public.hotel_reps (hotel_id, profile_id, is_primary) values
       ($1, $2, true), ($1, $3, false), ($4, $5, true)`,
    [hotelA, repA, repCover, hotelB, repB])

  // Minimum ages are data, not constants: A and B at 21, C at 23.
  const catA = await insertCategory(db, 'A', 21, 1)
  const catB = await insertCategory(db, 'B', 21, 1)
  const catC = await insertCategory(db, 'C', 23, 1)

  const modelA = await insertModel(db, 'Fiat', 'Panda', catA)
  const modelB = await insertModel(db, 'Toyota', 'Yaris', catB)
  const modelC = await insertModel(db, 'Jeep', 'Renegade', catC)

  const car1 = await insertCar(db, 'ABC-1001', modelA)
  const car2 = await insertCar(db, 'ABC-1002', modelA)
  const car3 = await insertCar(db, 'ABC-1003', modelB)
  const carC = await insertCar(db, 'ABC-1004', modelC)
  const archived = await insertCar(db, 'ABC-9999', modelA)
  await db.sql(`update public.cars set archived_at = now() where id = $1`, [archived])

  // Two adjacent periods in one season, so a rental can be made to cross the
  // boundary. Peak is dearer per day, which makes "the pickup date decides"
  // visible in the numbers.
  const low = await insertPeriod(db, 2026, 'Low', '2026-06-01', '2026-07-31')
  const peak = await insertPeriod(db, 2026, 'Peak', '2026-08-01', '2026-09-30')

  //                       1d   2d   3d   4d   5d   6d   7d   extra
  await insertPrices(db, low,  catA, [35, 65, 90, 115, 140, 160, 180], 25)
  await insertPrices(db, low,  catB, [40, 75, 105, 135, 165, 190, 215], 30)
  await insertPrices(db, low,  catC, [60, 115, 165, 210, 255, 295, 335], 45)
  await insertPrices(db, peak, catA, [55, 105, 150, 190, 230, 265, 300], 40)
  await insertPrices(db, peak, catB, [65, 125, 180, 230, 280, 325, 365], 48)
  await insertPrices(db, peak, catC, [90, 175, 255, 325, 395, 455, 515], 70)

  return {
    admin, repA, repB, repCover, inactive,
    hotelA, hotelB,
    catA, catB, catC,
    modelA, modelB, modelC,
    car1, car2, car3, carC, archived,
    low, peak,
  }
}

export async function createUser(
  db: TestDb, email: string, role: 'admin' | 'rep', fullName: string,
): Promise<string> {
  const id = await insertReturningId(db,
    `insert into auth.users (email, raw_user_meta_data)
     values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
    [email, fullName])
  await db.sql(`update public.profiles set role = $2 where id = $1`, [id, role])
  return id
}

async function insertCategory(db: TestDb, code: string, minAge: number, minYears: number) {
  return insertReturningId(db,
    `insert into public.categories (code, name_el, name_en, min_driver_age, min_licence_years, sort_order)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [code, `Κατηγορία ${code}`, `Category ${code}`, minAge, minYears, code.charCodeAt(0)])
}

async function insertModel(db: TestDb, make: string, model: string, categoryId: string) {
  return insertReturningId(db,
    `insert into public.car_models (make, model, category_id, transmission, fuel_type, seats, doors, tank_litres)
     values ($1, $2, $3, 'manual', 'petrol', 5, 5, 38.0) returning id`,
    [make, model, categoryId])
}

async function insertCar(db: TestDb, plate: string, modelId: string) {
  return insertReturningId(db,
    `insert into public.cars (plate, model_id, year, colour) values ($1, $2, 2024, 'white') returning id`,
    [plate, modelId])
}

async function insertPeriod(
  db: TestDb, year: number, name: string, start: string, end: string,
) {
  return insertReturningId(db,
    `insert into public.pricing_periods (season_year, name, start_date, end_date)
     values ($1, $2, $3, $4) returning id`,
    [year, name, start, end])
}

async function insertPrices(
  db: TestDb, periodId: string, categoryId: string, totals: number[], extraDay: number,
) {
  for (let i = 0; i < totals.length; i++) {
    await db.sql(
      `insert into public.price_rows (period_id, category_id, days, total)
       values ($1, $2, $3, $4)`,
      [periodId, categoryId, i + 1, totals[i]])
  }
  await db.sql(
    `insert into public.price_extra_day (period_id, category_id, price) values ($1, $2, $3)`,
    [periodId, categoryId, extraDay])
}

async function insertReturningId(db: TestDb, sql: string, params: unknown[] = []) {
  const row = await db.one<{ id: string }>(sql, params)
  return row.id
}

/** A booking created the way a rep creates one: only the fields they may send. */
export async function bookAsRep(
  db: TestDb,
  rep: string,
  input: {
    carId: string
    hotelId?: string | null
    adhocHotelName?: string | null
    start: string
    end: string
    first?: string
    last?: string
    phone?: string
    dob?: string
    room?: string
  },
): Promise<string> {
  return db.asUser(rep, async () => {
    const row = await db.one<{ id: string }>(
      `insert into public.bookings
         (car_id, hotel_id, adhoc_hotel_name, room_number, start_date, end_date,
          cust_first, cust_last, cust_phone, cust_dob)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id`,
      [
        input.carId, input.hotelId ?? null, input.adhocHotelName ?? null, input.room ?? '101',
        input.start, input.end,
        input.first ?? 'Anna', input.last ?? 'Visitor',
        input.phone ?? '+306900000000', input.dob ?? '1990-01-01',
      ])
    return row.id
  })
}
