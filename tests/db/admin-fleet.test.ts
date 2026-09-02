import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, type Fixtures } from '../helpers/fixtures'

// A2 · Fleet (car management) — categories, models, cars, and blocks are all reached
// through the same table grants a rep already holds (docs/06-IMPLEMENTATION-NOTES.md:
// "column grants plus admin RPCs, rather than admin-only tables"). The screens
// have no authorisation logic of their own; the guarantee lives entirely in
// the RLS policies and the admin_* RPCs asserted here, run from a rep session
// exactly as `isolation.test.ts` does for bookings.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

describe('a rep cannot write the fleet, categories or models', () => {
  test('inserting a category is refused', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.categories (code, name_el, name_en, min_driver_age, min_licence_years, sort_order)
       values ('Z', 'Ζ', 'Z', 21, 1, 99)`)))).toBe('42501')
  })

  test('updating a category is silently refused (RLS hides the row from the update)', async () => {
    const rows = await db.asUser(f.repA, () => db.sql(
      `update public.categories set min_driver_age = 1 where id = $1 returning id`, [f.catA]))
    expect(rows).toEqual([])
    const after = await db.one<{ min_driver_age: number }>(
      `select min_driver_age from public.categories where id = $1`, [f.catA])
    expect(after.min_driver_age).toBe(21)
  })

  test('inserting a model is refused', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.car_models (make, model, category_id, transmission, fuel_type, seats, doors)
       values ('Rep', 'Model', $1, 'manual', 'petrol', 5, 5)`, [f.catA])))).toBe('42501')
  })

  test('inserting a car is refused', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.cars (plate, model_id) values ('REP-0001', $1)`, [f.modelA])))).toBe('42501')
  })

  test('archiving a car is silently refused', async () => {
    const rows = await db.asUser(f.repA, () => db.sql(
      `update public.cars set archived_at = now() where id = $1 returning id`, [f.car1]))
    expect(rows).toEqual([])
    const after = await db.one<{ archived_at: string | null }>(
      `select archived_at from public.cars where id = $1`, [f.car1])
    expect(after.archived_at).toBeNull()
  })

  test('deleting a car is refused', async () => {
    await db.asUser(f.repA, () => db.sql(`delete from public.cars where id = $1`, [f.car1]))
    const rows = await db.sql(`select id from public.cars where id = $1`, [f.car1])
    expect(rows).toHaveLength(1)
  })
})

describe('the admin can manage the fleet end to end', () => {
  test('add a category, a model in it, and a car of that model', async () => {
    const category = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `insert into public.categories (code, name_el, name_en, min_driver_age, min_licence_years, sort_order)
       values ('Z', 'Κατηγορία Ζ', 'Category Z', 25, 2, 50) returning id`))

    const model = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `insert into public.car_models (make, model, category_id, transmission, fuel_type, seats, doors, tank_litres)
       values ('Admin', 'Special', $1, 'automatic', 'diesel', 5, 5, 55.0) returning id`,
      [category.id]))

    const car = await db.asUser(f.admin, () => db.one<{ id: string; plate: string }>(
      `insert into public.cars (plate, model_id, year, colour) values ('ZZZ-0001', $1, 2025, 'grey')
       returning id, plate`, [model.id]))

    expect(car.plate).toBe('ZZZ-0001')

    // A rep can read the specs (needed for eligibility and R2), but not the
    // admin-only notes column, which is not even in the grant.
    const readBack = await db.asUser(f.repA, () => db.one<{ plate: string }>(
      `select plate from public.cars where id = $1`, [car.id]))
    expect(readBack.plate).toBe('ZZZ-0001')
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select notes from public.cars where id = $1`, [car.id])))).toBe('42501')
  })

  test('archive and restore round-trips', async () => {
    await db.asUser(f.admin, () => db.sql(
      `update public.cars set archived_at = now() where id = $1`, [f.car1]))
    const archived = await db.one<{ archived_at: string | null }>(
      `select archived_at from public.cars where id = $1`, [f.car1])
    expect(archived.archived_at).not.toBeNull()

    // Archived cars vanish from a rep's view entirely.
    expect(await db.asUser(f.repA, () => db.sql(
      `select id from public.cars where id = $1`, [f.car1]))).toEqual([])

    await db.asUser(f.admin, () => db.sql(
      `update public.cars set archived_at = null where id = $1`, [f.car1]))
    const restored = await db.one<{ archived_at: string | null }>(
      `select archived_at from public.cars where id = $1`, [f.car1])
    expect(restored.archived_at).toBeNull()
  })
})

describe('car notes stay off the rep-readable columns', () => {
  test('admin_set_car_notes and admin_car_notes round-trip; a rep can reach neither', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_car_notes($1, 'gearbox noise, watch it')`, [f.car1]))

    const read = await db.asUser(f.admin, () => db.one<{ notes: string | null }>(
      `select public.admin_car_notes($1) as notes`, [f.car1]))
    expect(read.notes).toBe('gearbox noise, watch it')

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.admin_set_car_notes($1, 'mine now')`, [f.car1]))))
      .toBe('IR001')
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.admin_car_notes($1)`, [f.car1])))).toBe('IR001')
  })
})

describe('blocks — the A3 screen for service, repair and write-offs', () => {
  test('the admin can create, edit and remove a block through the RPCs', async () => {
    const created = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `select public.admin_create_block($1, '2027-01-10', '2027-01-15', 'gearbox service') as id`,
      [f.car1]))

    const [listed] = await db.asUser(f.admin, () => db.sql<{ id: string; block_reason: string }>(
      `select id, block_reason from public.admin_blocks('2027-01-01', '2027-01-31') where id = $1`,
      [created.id]))
    expect(listed?.block_reason).toBe('gearbox service')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_update_block($1, '2027-01-11', '2027-01-16', 'gearbox + brakes')`,
      [created.id]))
    const [updated] = await db.asUser(f.admin, () => db.sql<{ start_date: string; block_reason: string }>(
      `select start_date, block_reason from public.admin_blocks('2027-01-01', '2027-01-31') where id = $1`,
      [created.id]))
    expect(updated?.start_date).toBe('2027-01-11')
    expect(updated?.block_reason).toBe('gearbox + brakes')

    await db.asUser(f.admin, () => db.sql(`select public.admin_delete_block($1)`, [created.id]))
    expect(await db.asUser(f.admin, () => db.sql(
      `select id from public.admin_blocks('2027-01-01', '2027-01-31') where id = $1`,
      [created.id]))).toEqual([])
  })

  test('a block clashing with an existing booking is rejected by the exclusion constraint', async () => {
    await db.asUser(f.repA, () => db.sql(
      `insert into public.bookings (car_id, start_date, end_date, cust_first, cust_last, cust_phone, cust_dob)
       values ($1, '2026-07-10', '2026-07-14', 'Clash', 'Test', '+306900000000', '1990-01-01')`,
      [f.car3]))

    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select public.admin_create_block($1, '2026-07-12', '2026-07-16', 'overlaps a booking')`,
      [f.car3])))).toBe('23P01')
  })

  test('a rep is refused every block RPC, and cannot read block_reason directly', async () => {
    const block = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `select public.admin_create_block($1, '2027-03-01', '2027-03-03', 'x') as id`, [f.car2]))

    await db.asUser(f.repA, async () => {
      expect(await errcode(() => db.sql(
        `select public.admin_create_block($1, '2027-03-05', '2027-03-06', 'mine')`,
        [f.car2]))).toBe('IR001')
      expect(await errcode(() => db.sql(
        `select public.admin_update_block($1, '2027-03-01', '2027-03-04', 'mine')`,
        [block.id]))).toBe('IR001')
      expect(await errcode(() => db.sql(
        `select public.admin_delete_block($1)`, [block.id]))).toBe('IR001')
      expect(await errcode(() => db.sql(
        `select * from public.admin_blocks('2027-03-01', '2027-03-31')`))).toBe('IR001')
    })

    // Availability still shows the block's dates as opaquely occupied.
    const avail = await db.asUser(f.repA, () => db.one<{ occupied_dates: string[] }>(
      `select occupied_dates from public.availability('2027-03-01', '2027-03-31') where car_id = $1`,
      [f.car2]))
    expect(avail.occupied_dates).toContain('2027-03-02')
  })

  test('an unknown category is rejected, not guessed at, when adding a model', async () => {
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `insert into public.car_models (make, model, category_id, transmission, fuel_type, seats, doors)
       values ('X', 'Y', gen_random_uuid(), 'manual', 'petrol', 5, 5)`)))).toBe('23503')
  })
})
