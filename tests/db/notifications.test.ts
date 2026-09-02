import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// Push notifications (docs/01-DECISIONS.md §22), through
// supabase/migrations/20260830190000_notifications.sql.
//
//   Admin: exceptions — damage flagged, car not returned, eligibility override.
//   Reps:  morning summary of their pickups, evening reminder of returns due.
//
// The notifier runs as the service role, which bypasses RLS, so what a rep may
// be TOLD is decided by these functions and not by a policy. Two things are
// therefore under test above all: that a rep's digest contains only the
// movements §8 already lets them see, and that it contains no aggregate — §7
// gives a rep exactly one, their own cash in hand.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.sql(`delete from public.push_subscriptions`)
  await db.sql(`delete from public.exceptions`)
  await db.sql(`delete from public.bookings`)
  await db.sql(
    `update public.profiles
        set notify_morning = true, notify_evening = true, notify_exceptions = true`)
})

const subscribe = (profile: string, endpoint: string) =>
  db.asUser(profile, () => db.sql(
    `insert into public.push_subscriptions (profile_id, endpoint, keys)
     values ($1, $2, jsonb_build_object('p256dh', 'k', 'auth', 'a'))`, [profile, endpoint]))

const targets = (kind: string) =>
  db.as({ kind: 'service' }, () => db.sql<{ profile_id: string; endpoint: string }>(
    `select profile_id, endpoint from public.push_targets($1)`, [kind]))

const movements = (profile: string, on: string) =>
  db.as({ kind: 'service' }, () => db.sql<{
    kind: string; plate: string; guest: string; room: string
  }>(`select kind, plate, guest, room from public.rep_day_movements($1, $2)`, [profile, on]))

describe('who gets told what', () => {
  test('the morning and evening digests go to reps, never to the boss', async () => {
    await subscribe(f.repA, 'https://push.example/a')
    await subscribe(f.admin, 'https://push.example/boss')

    for (const kind of ['morning', 'evening']) {
      const rows = await targets(kind)
      expect(rows.map((r) => r.profile_id), kind).toEqual([f.repA])
    }
  })

  test('exceptions go to the boss, never to a rep — §14 makes them his business', async () => {
    await subscribe(f.repA, 'https://push.example/a')
    await subscribe(f.admin, 'https://push.example/boss')

    const rows = await targets('exceptions')
    expect(rows.map((r) => r.profile_id)).toEqual([f.admin])
  })

  test('a rep with notify_exceptions set is still never an exceptions target', async () => {
    await subscribe(f.repA, 'https://push.example/a')
    // The column is writable by the person it belongs to; the ROLE is what the
    // query checks, so setting it changes nothing for a rep.
    await db.asUser(f.repA, () => db.sql(
      `update public.profiles set notify_exceptions = true where id = $1`, [f.repA]))

    expect(await targets('exceptions')).toHaveLength(0)
  })

  test('a rep cannot opt out of morning or evening — 0027 clamps both regardless of who writes', async () => {
    await subscribe(f.repA, 'https://push.example/a')

    // The rep's own write is silently reverted...
    await db.asUser(f.repA, () => db.sql(
      `update public.profiles set notify_morning = false where id = $1`, [f.repA]))
    expect((await targets('morning')).map((r) => r.profile_id)).toEqual([f.repA])

    // ...and so is the server's, on their behalf: for a 'rep' row the clamp in
    // app.profiles_before_write() does not check auth.uid() at all. There is
    // no writer left, direct or server, that can turn either kind off.
    await db.as({ kind: 'service' }, () => db.sql(
      `update public.profiles set notify_evening = false where id = $1`, [f.repA]))
    expect((await targets('evening')).map((r) => r.profile_id)).toEqual([f.repA])
  })

  test('a deactivated account is told nothing, however many devices it registered', async () => {
    await subscribe(f.repA, 'https://push.example/a')
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_user_active($1, false)`, [f.repA]))

    expect(await targets('morning')).toHaveLength(0)

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_user_active($1, true)`, [f.repA]))
  })

  test('an unknown kind reaches nobody, rather than everybody', async () => {
    await subscribe(f.repA, 'https://push.example/a')
    await subscribe(f.admin, 'https://push.example/boss')
    expect(await targets('everything')).toHaveLength(0)
  })

  test('one person on two phones is two targets', async () => {
    await subscribe(f.repA, 'https://push.example/phone')
    await subscribe(f.repA, 'https://push.example/tablet')
    expect(await targets('morning')).toHaveLength(2)
  })
})

describe("a rep's digest is their own day, and nothing more", () => {
  const today = '2026-07-06'

  test('their own pickups and returns, listed', async () => {
    const mine = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: today, end: '2026-07-09',
      first: 'Anna', last: 'Visitor', room: '204',
    })
    expect(mine).toBeTruthy()

    const rows = await movements(f.repA, today)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'pickup', plate: 'ABC-1001', guest: 'Anna Visitor', room: '204' })
  })

  test('a return due today is a return, not a pickup', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-02', end: today,
    })
    const rows = await movements(f.repA, today)
    expect(rows.map((r) => r.kind)).toEqual(['return'])
  })

  test('another rep\'s booking at another hotel is not in it', async () => {
    await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: today, end: '2026-07-09',
    })
    expect(await movements(f.repA, today)).toHaveLength(0)
  })

  test('a covering colleague\'s hotel IS in it — that is the §8 rule', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: today, end: '2026-07-09',
    })
    // repCover covers Hotel Alpha.
    expect(await movements(f.repCover, today)).toHaveLength(1)
    expect(await movements(f.repB, today)).toHaveLength(0)
  })

  test('a cancelled or returned booking is not a movement to remind anybody about', async () => {
    const b = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: today, end: '2026-07-09',
    })
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'cancelled' where id = $1`, [b]))

    expect(await movements(f.repA, today)).toHaveLength(0)
  })

  test('an admin block is never a movement — a rep must not learn a car is blocked', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_create_block($1, $2, $3, 'Gearbox')`,
      [f.car2, today, '2026-07-09']))

    expect(await movements(f.repA, today)).toHaveLength(0)
  })

  test('it carries no price, no total and no count — §7 allows a rep one aggregate', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: today, end: '2026-07-09',
    })

    // The columns the function is DECLARED to return, so a future widening
    // that added a total would fail here rather than on a rep's lock screen.
    const columns = await db.sql<{ parameter_name: string }>(
      `select p.parameter_name
       from information_schema.parameters p
       join information_schema.routines r on r.specific_name = p.specific_name
       where r.routine_schema = 'public' and r.routine_name = 'rep_day_movements'
         and p.parameter_mode = 'OUT'
       order by p.ordinal_position`)

    const names = columns.map((c) => c.parameter_name)
    expect(names).toEqual(['kind', 'booking_id', 'at', 'plate', 'guest', 'room'])
    for (const forbidden of ['price', 'count', 'total', 'sum']) {
      expect(names).not.toContain(forbidden)
    }
  })
})

describe('the boss is told about an exception exactly once', () => {
  async function raise(type = 'new_damage') {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-09',
    })
    await db.asUser(f.repA, () => db.sql(
      `insert into public.exceptions (booking_id, type, detail, raised_by)
       values ($1, $2::public.exception_type, '1: front/dent', $3)`,
      [bookingId, type, f.repA]))
    return bookingId
  }

  const pending = () => db.as({ kind: 'service' }, () => db.sql<{
    id: string; type: string; booking_ref: string; plate: string
  }>(`select id, type, booking_ref, plate from public.pending_exception_notifications()`))

  test('a newly raised exception is pending, with just enough to write a line', async () => {
    await raise()
    const rows = await pending()

    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('new_damage')
    expect(rows[0]?.plate).toBe('ABC-1001')
    expect(rows[0]?.booking_ref).toMatch(/^\d{4}-\d{4}$/)
  })

  test('once marked, it is never pending again', async () => {
    await raise()
    const [row] = await pending()

    const marked = await db.as({ kind: 'service' }, () => db.one<{ v: number }>(
      `select public.mark_exceptions_notified(array[$1]::uuid[]) as v`, [row!.id]))
    expect(marked.v).toBe(1)
    expect(await pending()).toHaveLength(0)

    // A second sweep marks nothing — the stamp is one-way.
    const again = await db.as({ kind: 'service' }, () => db.one<{ v: number }>(
      `select public.mark_exceptions_notified(array[$1]::uuid[]) as v`, [row!.id]))
    expect(again.v).toBe(0)
  })

  test('an exception raised by the eligibility override is swept like any other', async () => {
    // Three code paths raise exceptions today and more will later, which is
    // why the notifier sweeps rather than being called from each of them.
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-09',
    })
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_override_eligibility($1, 'Passport checked by hand')`, [bookingId]))

    const rows = await pending()
    expect(rows.map((r) => r.type)).toEqual(['eligibility_override'])
  })

  test('a rep cannot mark the boss\'s inbox as read', async () => {
    await raise()
    const [row] = await pending()

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.mark_exceptions_notified(array[$1]::uuid[])`, [row!.id])))).toBe('42501')

    // Nor by writing the column, which is in no client grant.
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.exceptions set notified_at = now() where id = $1`, [row!.id]))))
      .toBe('42501')

    expect(await pending()).toHaveLength(1)
  })
})

describe('the notifier is the server\'s own, not a session\'s', () => {
  test('no signed-in caller reaches any of its functions', async () => {
    for (const who of [f.admin, f.repA]) {
      expect(await errcode(() => db.asUser(who, () => db.sql(
        `select profile_id from public.push_targets('morning')`))), who).toBe('42501')
      expect(await errcode(() => db.asUser(who, () => db.sql(
        `select kind from public.rep_day_movements($1, '2026-07-06')`, [f.repA])))).toBe('42501')
      expect(await errcode(() => db.asUser(who, () => db.sql(
        `select id from public.pending_exception_notifications()`)))).toBe('42501')
      expect(await errcode(() => db.asUser(who, () => db.sql(
        `select public.drop_push_subscription('https://push.example/a')`)))).toBe('42501')
    }
  })

  test('a rep sees and deletes only their own subscriptions', async () => {
    await subscribe(f.repA, 'https://push.example/a')
    await subscribe(f.repB, 'https://push.example/b')

    const seen = await db.asUser(f.repA, () => db.sql<{ endpoint: string }>(
      `select endpoint from public.push_subscriptions`))
    expect(seen.map((s) => s.endpoint)).toEqual(['https://push.example/a'])

    await db.asUser(f.repA, () => db.sql(
      `delete from public.push_subscriptions where endpoint = $1`, ['https://push.example/b']))
    expect(await db.sql(`select id from public.push_subscriptions`)).toHaveLength(2)
  })

  test('a rep cannot register a device against somebody else', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.push_subscriptions (profile_id, endpoint, keys)
       values ($1, 'https://push.example/planted', '{}'::jsonb)`, [f.repB])))).toBe('42501')
  })
})
