import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, createUser, type Fixtures } from '../helpers/fixtures'

// A8 · Users & hotels (docs/04-SCREENS.md), and the migration that made it
// possible: supabase/migrations/20260830140000_users_and_hotels.sql.
//
// A8 IS THE ISOLATION BOUNDARY. `hotel_reps` is what app.my_hotel_ids() reads,
// and app.my_hotel_ids() is what the cover-shift rule in docs/01-DECISIONS.md
// §8 is built on — so every row this screen writes re-shapes who can see whose
// bookings. That is why the headline test here is not "the admin can assign a
// hotel" but "assigning one changes visibility, and UNassigning one takes it
// away again": a permission that cannot be withdrawn is not a permission.
//
// Everything is run from a real session — a rep's for the refusals, the
// admin's for the writes. There is no service-role shortcut.

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

const canSee = async (rep: string, bookingId: string) =>
  (await db.asUser(rep, () => db.sql(
    `select id from public.bookings where id = $1`, [bookingId]))).length

describe('the staff list', () => {
  test('the admin gets every account, with the address it signs in with', async () => {
    const rows = await db.asUser(f.admin, () => db.sql<{
      id: string; email: string; role: string; active: boolean; last_sign_in_at: string | null
    }>(`select id, email, role, active, last_sign_in_at from public.admin_list_users()`))

    expect(rows.map((r) => r.email).sort()).toEqual([
      'boss@example.com', 'gone@example.com', 'rep-a@example.com',
      'rep-b@example.com', 'rep-cover@example.com',
    ])
    // A deactivated rep is still on the list — that is the whole point of
    // deactivating rather than deleting.
    expect(rows.find((r) => r.email === 'gone@example.com')?.active).toBe(false)
  })

  test('a rep gets nothing from it — not even their own row', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select id from public.admin_list_users()`)))).toBe('IR001')
  })

  test('a rep still cannot read another rep\'s profile row directly', async () => {
    const seen = await db.asUser(f.repA, () => db.sql(
      `select id, full_name from public.profiles`))
    expect(seen).toHaveLength(1)
    expect((seen[0] as { id: string }).id).toBe(f.repA)
  })

  test('no session of any kind reaches auth.users', async () => {
    for (const who of [f.admin, f.repA]) {
      expect(await errcode(() => db.asUser(who, () => db.sql(
        `select email from auth.users`)))).toBe('42501')
    }
    // Not the service role either: creating an account is GoTrue's job, done
    // through its Admin API, which is why src/lib/users/accounts.ts exists.
    expect(await errcode(() => db.as({ kind: 'service' }, () => db.sql(
      `insert into auth.users (email) values ('sneak@example.com')`)))).toBe('42501')
  })
})

describe('stationing a rep is what decides what they can see', () => {
  test('assigning a hotel grants visibility; unassigning takes it back', async () => {
    const booking = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })

    // Rep B is at Hotel Beta and has no business with this booking.
    expect(await canSee(f.repB, booking)).toBe(0)

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_cover($1, $2, true)`, [f.repB, f.hotelA]))
    expect(await canSee(f.repB, booking)).toBe(1)

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_cover($1, $2, false)`, [f.repB, f.hotelA]))
    expect(await canSee(f.repB, booking)).toBe(0)
  })

  test('moving a rep\'s home hotel moves their sight with it, both ways', async () => {
    const atAlpha = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    const atBeta = await bookAsRep(db, f.repB, {
      carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-08',
    })

    const mover = await createUser(db, 'mover@example.com', 'rep', 'Mover')
    expect(await canSee(mover, atAlpha)).toBe(0)
    expect(await canSee(mover, atBeta)).toBe(0)

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_home_hotel($1, $2)`, [mover, f.hotelA]))
    expect(await canSee(mover, atAlpha)).toBe(1)
    expect(await canSee(mover, atBeta)).toBe(0)

    // The move is one movement: Alpha closes as Beta opens, and there is no
    // instant in between where the rep is stationed at both or at neither.
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_home_hotel($1, $2)`, [mover, f.hotelB]))
    expect(await canSee(mover, atAlpha)).toBe(0)
    expect(await canSee(mover, atBeta)).toBe(1)

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_home_hotel($1, null)`, [mover]))
    expect(await canSee(mover, atAlpha)).toBe(0)
    expect(await canSee(mover, atBeta)).toBe(0)
  })

  test('a rep never loses sight of a booking they created themselves', async () => {
    const own = await bookAsRep(db, f.repA, {
      carId: f.car2, hotelId: f.hotelA, start: '2026-07-20', end: '2026-07-22',
    })
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_home_hotel($1, null)`, [f.repA]))

    // §8: the creating rep AND the hotel's rep. Unstationing removes the
    // second half only.
    expect(await canSee(f.repA, own)).toBe(1)

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_home_hotel($1, $2)`, [f.repA, f.hotelA]))
  })

  test('a rep is stationed at ONE hotel — the second primary is refused', async () => {
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `insert into public.hotel_reps (hotel_id, profile_id, is_primary)
       values ($1, $2, true)`, [f.hotelB, f.repA])))).toBe('23505')
  })

  test('a cover assignment is not a way to claim a second home hotel', async () => {
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select public.admin_set_cover($1, $2, true)`, [f.repA, f.hotelA])))).toBe('IR115')
  })

  test('removing a cover cannot be the click that unstations a rep', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_cover($1, $2, false)`, [f.repA, f.hotelA]))

    const still = await db.sql<{ is_primary: boolean }>(
      `select is_primary from public.hotel_reps where profile_id = $1 and hotel_id = $2`,
      [f.repA, f.hotelA])
    expect(still.map((r) => r.is_primary)).toEqual([true])
  })
})

describe('a rep cannot manage users or hotels, by any route', () => {
  test('not through the RPCs', async () => {
    for (const call of [
      [`select public.admin_set_home_hotel($1, $2)`, [f.repA, f.hotelB]],
      [`select public.admin_set_cover($1, $2, true)`, [f.repA, f.hotelB]],
      [`select public.admin_set_user_role($1, 'admin')`, [f.repA]],
      [`select public.admin_set_user_active($1, false)`, [f.repB]],
    ] as const) {
      expect(await errcode(() => db.asUser(f.repA, () => db.sql(call[0], [...call[1]]))), call[0])
        .toBe('IR001')
    }
  })

  test('not by writing hotel_reps directly — the policy refuses the row', async () => {
    expect(await errcode(() => db.asUser(f.repB, () => db.sql(
      `insert into public.hotel_reps (hotel_id, profile_id, is_primary)
       values ($1, $2, false)`, [f.hotelA, f.repB])))).toBe('42501')

    // Nor by deleting somebody else's assignment to close their eyes.
    await db.asUser(f.repB, () => db.sql(
      `delete from public.hotel_reps where profile_id = $1`, [f.repA]))
    const survived = await db.sql(
      `select profile_id from public.hotel_reps where profile_id = $1`, [f.repA])
    expect(survived).toHaveLength(1)
  })

  test('not by creating or renaming a hotel', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.hotels (name) values ('Rep''s Own Hotel')`)))).toBe('42501')

    await db.asUser(f.repA, () => db.sql(
      `update public.hotels set name = 'Renamed' where id = $1`, [f.hotelA]))
    const name = await db.one<{ name: string }>(
      `select name from public.hotels where id = $1`, [f.hotelA])
    expect(name.name).toBe('Hotel Alpha')
  })

  test('not by promoting themselves — role and active are in no client grant', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.profiles set role = 'admin' where id = $1`, [f.repA])))).toBe('42501')
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.profiles set active = true where id = $1`, [f.inactive])))).toBe('42501')
  })
})

describe('the boss cannot lock himself out', () => {
  test('and cannot demote himself either (IR113)', async () => {
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select public.admin_set_user_role($1, 'rep')`, [f.admin])))).toBe('IR113')
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `select public.admin_set_user_active($1, false)`, [f.admin])))).toBe('IR113')

    const boss = await db.one<{ role: string; active: boolean }>(
      `select role, active from public.profiles where id = $1`, [f.admin])
    expect(boss).toEqual({ role: 'admin', active: true })
  })

  test('a deactivated account is refused everywhere, and keeps its history', async () => {
    const booking = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-08-10', end: '2026-08-12',
    })

    try {
      await db.asUser(f.admin, () => db.sql(
        `select public.admin_set_user_active($1, false)`, [f.repA]))

      // app.is_staff() is false, so app.can_read_booking() is false, so even
      // the rep's OWN booking is out of reach — while the row itself is
      // untouched and the boss still sees everything.
      expect(await canSee(f.repA, booking)).toBe(0)
      expect(await canSee(f.admin, booking)).toBe(1)
    } finally {
      await db.asUser(f.admin, () => db.sql(
        `select public.admin_set_user_active($1, true)`, [f.repA]))
    }
    expect(await canSee(f.repA, booking)).toBe(1)
  })
})

describe('the PIN belongs to the rep whose device it unlocks', () => {
  test('the admin can rename a rep but cannot set their PIN', async () => {
    await db.sql(`update public.profiles set pin_hash = 'argon2-the-rep-set-this' where id = $1`,
      [f.repA])

    await db.asUser(f.admin, () => db.sql(
      `update public.profiles set full_name = 'Renamed By The Boss', pin_hash = 'planted'
        where id = $1`, [f.repA]))

    const after = await db.one<{ full_name: string; pin_hash: string }>(
      `select full_name, pin_hash from public.profiles where id = $1`, [f.repA])
    expect(after.full_name).toBe('Renamed By The Boss')
    expect(after.pin_hash).toBe('argon2-the-rep-set-this')
  })

  test('a rep cannot set their own PIN directly — only set_pin_hash() through the service role can', async () => {
    // A baseline, planted the only way anyone can plant one: through the RPC.
    await db.as({ kind: 'service' }, () => db.sql(
      `select public.set_pin_hash($1, 'baseline', true)`, [f.repB]))

    // 0027 closed the raw-PostgREST gap: the guard restores pin_hash whenever
    // auth.uid() is not null, so the rep's own direct write is a no-op. 0034
    // gave the rep a change-PIN screen back, but not this door — it goes
    // through the same RPC below.
    await db.asUser(f.repB, () => db.sql(
      `update public.profiles set pin_hash = 'mine' where id = $1`, [f.repB]))
    expect((await db.one<{ pin_hash: string }>(
      `select pin_hash from public.profiles where id = $1`, [f.repB])).pin_hash).toBe('baseline')

    // The unlock/reissue/change path hashes in Node and stores through this RPC
    // on the service role, where auth.uid() is null and the guard steps aside.
    await db.as({ kind: 'service' }, () => db.sql(
      `select public.set_pin_hash($1, 'set-by-the-server', true)`, [f.repB]))
    expect((await db.one<{ pin_hash: string }>(
      `select pin_hash from public.profiles where id = $1`, [f.repB])).pin_hash)
      .toBe('set-by-the-server')
  })

  /**
   * 0034 · A PIN the boss generated is temporary, and the rep replacing it is
   * what makes it permanent (docs/01-DECISIONS.md §38). The flag that carries
   * that is only as good as its being unreachable from the rep's own session:
   * a rep who can clear it has dismissed the prompt without changing anything.
   */
  test('set_pin_hash records who chose the PIN, and the rep cannot rewrite that answer', async () => {
    const mustChange = async () => (await db.one<{ pin_must_change: boolean }>(
      `select pin_must_change from public.profiles where id = $1`, [f.repB])).pin_must_change

    // What the boss's create/re-issue does: a PIN he has read off a screen.
    await db.as({ kind: 'service' }, () => db.sql(
      `select public.set_pin_hash($1, 'issued-by-the-boss', true)`, [f.repB]))
    expect(await mustChange()).toBe(true)

    // The rep cannot simply say they have dealt with it: the column is in no
    // client update grant, so the write is refused before a policy or a trigger
    // is reached at all.
    expect(await errcode(() => db.asUser(f.repB, () => db.sql(
      `update public.profiles set pin_must_change = false where id = $1`, [f.repB]))))
      .toBe('42501')

    // Nor can the boss clear it for them — the flag is about a secret only the
    // rep is meant to end up holding, and he is the person it is kept from.
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `update public.profiles set pin_must_change = false where id = $1`, [f.repB]))))
      .toBe('42501')

    // And if that grant were ever handed out — which is exactly what happened to
    // pin_hash in 0011 and is why 0027 had to exist — the guard is what still
    // refuses. Granted and revoked around the assertion so the belt is tested
    // with the braces deliberately off.
    await db.sql(`grant update (pin_must_change) on public.profiles to authenticated`)
    try {
      await db.asUser(f.repB, () => db.sql(
        `update public.profiles set pin_must_change = false where id = $1`, [f.repB]))
      expect(await mustChange()).toBe(true)
    } finally {
      await db.sql(`revoke update (pin_must_change) on public.profiles from authenticated`)
    }

    // Changing the PIN is what clears it, and the two happen in one statement
    // so neither can happen without the other.
    await db.as({ kind: 'service' }, () => db.sql(
      `select public.set_pin_hash($1, 'chosen-by-the-rep', false)`, [f.repB]))
    expect(await mustChange()).toBe(false)
    expect((await db.one<{ pin_hash: string }>(
      `select pin_hash from public.profiles where id = $1`, [f.repB])).pin_hash)
      .toBe('chosen-by-the-rep')

    // And a re-issue puts it back: the boss knows this PIN too.
    await db.as({ kind: 'service' }, () => db.sql(
      `select public.set_pin_hash($1, 'reissued', true)`, [f.repB]))
    expect(await mustChange()).toBe(true)
  })
})

describe('hotels are deactivated, not deleted, once they have been used', () => {
  test('a hotel with a booking against it cannot be deleted', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `delete from public.hotels where id = $1`, [f.hotelA])))).toBe('23503')
  })

  test('deactivating one hides it from new bookings and changes nothing else', async () => {
    const booking = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await db.asUser(f.admin, () => db.sql(
      `update public.hotels set active = false where id = $1`, [f.hotelA]))

    // staff_hotels() is what R3 offers a rep to book against.
    const offered = await db.asUser(f.repA, () => db.sql<{ id: string }>(
      `select id from public.staff_hotels()`))
    expect(offered.map((h) => h.id)).not.toContain(f.hotelA)

    // The assignment and the history are untouched.
    expect(await canSee(f.repA, booking)).toBe(1)
    expect(await canSee(f.repCover, booking)).toBe(1)

    await db.asUser(f.admin, () => db.sql(
      `update public.hotels set active = true where id = $1`, [f.hotelA]))
  })

  test('a hotel nobody has used is removable, and takes its assignments with it', async () => {
    const spare = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `insert into public.hotels (name, area) values ('Typo Hotel', 'Nowhere') returning id`))
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_cover($1, $2, true)`, [f.repB, spare.id]))

    await db.asUser(f.admin, () => db.sql(`delete from public.hotels where id = $1`, [spare.id]))

    expect(await db.sql(
      `select profile_id from public.hotel_reps where hotel_id = $1`, [spare.id])).toHaveLength(0)
  })
})

describe('every one of these writes is on the record', () => {
  test('the audit log carries the actor and the change', async () => {
    await db.sql(`delete from public.audit_log`)

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_cover($1, $2, true)`, [f.repB, f.hotelA]))
    await db.asUser(f.admin, () => db.sql(
      `update public.profiles set full_name = 'Audited' where id = $1`, [f.repB]))

    const entries = await db.asUser(f.admin, () => db.sql<{
      entity: string; action: string; actor_id: string; after: Record<string, unknown>
    }>(`select entity, action, actor_id, after from public.audit_log order by id`))

    expect(entries.map((e) => `${e.entity}:${e.action}`))
      .toEqual(['hotel_reps:insert', 'profiles:update'])
    expect(entries.every((e) => e.actor_id === f.admin)).toBe(true)

    // app.audit_redact() keeps pin_hash out of the log, on this path too.
    expect(entries[1]?.after).not.toHaveProperty('pin_hash')

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_set_cover($1, $2, false)`, [f.repB, f.hotelA]))
  })
})
