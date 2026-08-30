import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// The licence-image retention purge (docs/01-DECISIONS.md §25), and the
// migration behind it: supabase/migrations/20260830160000_retention.sql.
//
// THIS DELETES REAL PERSONAL DATA AND CANNOT BE UNDONE. It runs as the service
// role, which bypasses RLS entirely, so the predicate is the only thing
// standing between a correct sweep and deleting a contract — which is why the
// tests here are mostly about what it must NOT pick up. Rows are seeded on
// both sides of the window before anything is asked to delete.
//
// The deletion itself is not here: `delete from storage.objects` would remove
// the metadata row and leave the file in the bucket, so src/lib/retention/
// purge.ts does it through the Storage API. What is under test is the list
// that job is handed.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)

  // A rental that ended 30 months ago was priced by a period that existed 30
  // months ago — pricing periods are re-edited each season, not deleted
  // (docs/01-DECISIONS.md §6). Without one, back-dating a booking here fails
  // IR100 inside app.bookings_before_write(), which is the engine correctly
  // refusing to guess. So the history the purge sweeps gets the price table it
  // would really have had, rather than the trigger being switched off.
  const historic = await db.one<{ id: string }>(
    `insert into public.pricing_periods (season_year, name, start_date, end_date)
     values (2020, 'Archive', '2020-01-01', '2026-05-31') returning id`)
  const table = [[1, 3000], [2, 5500], [3, 8000], [4, 10000],
                 [5, 12000], [6, 13500], [7, 15000]] as const
  for (const [days, cents] of table) {
    await db.sql(
      `insert into public.price_rows (period_id, category_id, days, total_cents)
       values ($1, $2, $3, $4)`, [historic.id, f.catA, days, cents])
  }
  await db.sql(
    `insert into public.price_extra_day (period_id, category_id, cents) values ($1, $2, 2000)`,
    [historic.id, f.catA])
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.sql(`delete from storage.objects`)
  await db.sql(`delete from public.bookings`)
  await db.sql(`update public.app_settings set licence_retention_months = 24 where id = 1`)
})

const BUCKET = 'booking-files'

/** A booking whose rental ended `monthsAgo` months back, with files on it. */
async function endedMonthsAgo(monthsAgo: number, kinds: string[] = ['licences']) {
  const bookingId = await bookAsRep(db, f.repA, {
    carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
  })
  // Priced from a real period first, then back-dated: quote() would fail for a
  // pickup date no pricing period covers, and the rental's age is what is
  // under test, not the tariff.
  await db.sql(
    `update public.bookings
        set start_date = (app.today() - make_interval(months => $2))::date - 2,
            end_date   = (app.today() - make_interval(months => $2))::date
      where id = $1`, [bookingId, monthsAgo])

  for (const kind of kinds) {
    await db.as({ kind: 'service' }, () => db.sql(
      `insert into storage.objects (bucket_id, name, metadata)
       values ($1, $2, '{}'::jsonb)`, [BUCKET, `${bookingId}/${kind}/file.jpg`]))
  }
  return bookingId
}

const due = () => db.as({ kind: 'service' }, () => db.sql<{ object_name: string }>(
  `select object_name from public.licence_images_due_for_purge()`))

describe('the window', () => {
  test('a rental that ended longer ago than the window is due; one inside it is not', async () => {
    const old = await endedMonthsAgo(30)
    await endedMonthsAgo(12)

    expect((await due()).map((r) => r.object_name)).toEqual([`${old}/licences/file.jpg`])
  })

  test('the boundary is the window itself, and it moves when the admin moves it', async () => {
    const at18 = await endedMonthsAgo(18)
    expect(await due()).toHaveLength(0)

    await db.asUser(f.admin, () => db.sql(
      `update public.app_settings set licence_retention_months = 12 where id = 1`))
    expect((await due()).map((r) => r.object_name)).toEqual([`${at18}/licences/file.jpg`])

    // And back: nothing is due once the boss lengthens the window again.
    await db.asUser(f.admin, () => db.sql(
      `update public.app_settings set licence_retention_months = 24 where id = 1`))
    expect(await due()).toHaveLength(0)
  })

  test('a rental still running is never due, however old its start date', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await db.sql(
      `update public.bookings
          set start_date = (app.today() - make_interval(months => 40))::date,
              end_date   = app.today() + 3
        where id = $1`, [bookingId])
    await db.as({ kind: 'service' }, () => db.sql(
      `insert into storage.objects (bucket_id, name, metadata)
       values ($1, $2, '{}'::jsonb)`, [BUCKET, `${bookingId}/licences/file.jpg`]))

    expect(await due()).toHaveLength(0)
  })
})

describe('what the sweep must never touch', () => {
  test('the contract PDF and the signature are retained — §25 says so', async () => {
    const bookingId = await endedMonthsAgo(36, ['licences', 'contract', 'signature', 'damage'])

    expect((await due()).map((r) => r.object_name))
      .toEqual([`${bookingId}/licences/file.jpg`])
  })

  test('an object whose booking has vanished is an orphan, not a candidate', async () => {
    const stranger = '00000000-0000-4000-8000-000000000000'
    await db.as({ kind: 'service' }, () => db.sql(
      `insert into storage.objects (bucket_id, name, metadata)
       values ($1, $2, '{}'::jsonb)`, [BUCKET, `${stranger}/licences/file.jpg`]))

    expect(await due()).toHaveLength(0)

    const status = await db.asUser(f.admin, () => db.one<{
      due_count: string; orphan_count: string
    }>(`select due_count, orphan_count from public.admin_licence_retention_status()`))
    expect(Number(status.due_count)).toBe(0)
    expect(Number(status.orphan_count)).toBe(1)
  })

  test('a malformed object name is skipped, and does not abandon the sweep', async () => {
    const old = await endedMonthsAgo(30)

    // Names a bare ::uuid cast in a join would raise 22P02 on. The service
    // role can write any of them, and so could a future policy change.
    for (const name of [
      'loose.jpg',
      'not-a-uuid/licences/file.jpg',
      `${old}/licences/nested/file.jpg`,
      '/licences/file.jpg',
    ]) {
      await db.as({ kind: 'service' }, () => db.sql(
        `insert into storage.objects (bucket_id, name, metadata)
         values ($1, $2, '{}'::jsonb)`, [BUCKET, name]))
    }

    // The good row still comes back, which is the point: one bad name must not
    // cost a scheduled job its whole run.
    expect((await due()).map((r) => r.object_name)).toEqual([`${old}/licences/file.jpg`])
  })

  test('nothing outside the bucket is visible to it at all', async () => {
    const old = await endedMonthsAgo(30)
    await db.sql(`insert into storage.buckets (id, name, public) values ('other', 'other', false)`)
    await db.as({ kind: 'service' }, () => db.sql(
      `insert into storage.objects (bucket_id, name, metadata)
       values ('other', $1, '{}'::jsonb)`, [`${old}/licences/file.jpg`]))

    expect(await due()).toHaveLength(1)

    await db.sql(`delete from storage.objects where bucket_id = 'other'`)
    await db.sql(`delete from storage.buckets where id = 'other'`)
  })
})

describe('a cleared pointer column hides nothing', () => {
  test('the sweep reads the bucket, not booking_drivers', async () => {
    const bookingId = await endedMonthsAgo(30)
    const driver = await db.asUser(f.repA, () => db.one<{ id: string }>(
      `insert into public.booking_drivers
         (booking_id, is_main, first_name, last_name, dob, licence_number,
          front_image_path)
       values ($1, true, 'A', 'B', '1985-01-01', 'LIC-1', $2) returning id`,
      [bookingId, `${bookingId}/licences/file.jpg`]))

    await db.asUser(f.repA, () => db.sql(
      `update public.booking_drivers set front_image_path = null where id = $1`, [driver.id]))

    expect((await due()).map((r) => r.object_name)).toEqual([`${bookingId}/licences/file.jpg`])
  })
})

describe('recording that it happened', () => {
  test('mark_licences_purged() stamps the drivers and clears the dead pointers', async () => {
    const bookingId = await endedMonthsAgo(30)
    await db.asUser(f.repA, () => db.sql(
      `insert into public.booking_drivers
         (booking_id, is_main, first_name, last_name, dob, licence_number,
          licence_country, front_image_path, back_image_path)
       values ($1, true, 'Anna', 'Visitor', '1985-01-01', 'LIC-12345', 'GR', $2, $3)`,
      [bookingId, `${bookingId}/licences/f.jpg`, `${bookingId}/licences/b.jpg`]))

    const marked = await db.as({ kind: 'service' }, () => db.one<{ v: number }>(
      `select public.mark_licences_purged(array[$1]::uuid[]) as v`, [bookingId]))
    expect(marked.v).toBe(1)

    const after = await db.one<{
      images_purged_at: string | null; front_image_path: string | null
      back_image_path: string | null; licence_number: string; first_name: string
    }>(`select images_purged_at, front_image_path, back_image_path, licence_number, first_name
        from public.booking_drivers where booking_id = $1`, [bookingId])

    expect(after.images_purged_at).not.toBeNull()
    expect(after.front_image_path).toBeNull()
    expect(after.back_image_path).toBeNull()
    // §25: the booking record and the TYPED licence number are retained.
    expect(after.licence_number).toBe('LIC-12345')
    expect(after.first_name).toBe('Anna')
  })

  test('it is idempotent — a second run marks nothing again', async () => {
    const bookingId = await endedMonthsAgo(30)
    await db.asUser(f.repA, () => db.sql(
      `insert into public.booking_drivers
         (booking_id, is_main, first_name, last_name, dob, front_image_path)
       values ($1, true, 'A', 'B', '1985-01-01', $2)`,
      [bookingId, `${bookingId}/licences/f.jpg`]))

    const first = await db.as({ kind: 'service' }, () => db.one<{ v: number }>(
      `select public.mark_licences_purged(array[$1]::uuid[]) as v`, [bookingId]))
    const second = await db.as({ kind: 'service' }, () => db.one<{ v: number }>(
      `select public.mark_licences_purged(array[$1]::uuid[]) as v`, [bookingId]))

    expect(first.v).toBe(1)
    expect(second.v).toBe(0)
  })

  test('an empty list is a no-op, not a sweep of everything', async () => {
    const bookingId = await endedMonthsAgo(30)
    await db.asUser(f.repA, () => db.sql(
      `insert into public.booking_drivers
         (booking_id, is_main, first_name, last_name, dob, front_image_path)
       values ($1, true, 'A', 'B', '1985-01-01', $2)`,
      [bookingId, `${bookingId}/licences/f.jpg`]))

    for (const arg of ['null::uuid[]', "'{}'::uuid[]"]) {
      const r = await db.as({ kind: 'service' }, () => db.one<{ v: number }>(
        `select public.mark_licences_purged(${arg}) as v`))
      expect(r.v).toBe(0)
    }

    const untouched = await db.one<{ front_image_path: string | null }>(
      `select front_image_path from public.booking_drivers where booking_id = $1`, [bookingId])
    expect(untouched.front_image_path).toBe(`${bookingId}/licences/f.jpg`)
  })
})

describe('who may run it', () => {
  test('the job\'s two functions are the service role\'s alone', async () => {
    for (const who of [f.admin, f.repA]) {
      expect(await errcode(() => db.asUser(who, () => db.sql(
        `select object_name from public.licence_images_due_for_purge()`)))).toBe('42501')
      expect(await errcode(() => db.asUser(who, () => db.sql(
        `select public.mark_licences_purged(array[]::uuid[])`)))).toBe('42501')
    }
  })

  test('the status A10 shows is the admin\'s alone', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select due_count from public.admin_licence_retention_status()`)))).toBe('IR001')

    const status = await db.asUser(f.admin, () => db.one<{ retention_months: number }>(
      `select retention_months from public.admin_licence_retention_status()`))
    expect(status.retention_months).toBe(24)
  })

  test('a rep cannot lengthen or shorten the window', async () => {
    await db.asUser(f.repA, () => db.sql(
      `update public.app_settings set licence_retention_months = 1 where id = 1`))
    const months = await db.one<{ licence_retention_months: number }>(
      `select licence_retention_months from public.app_settings`)
    expect(months.licence_retention_months).toBe(24)
  })
})
