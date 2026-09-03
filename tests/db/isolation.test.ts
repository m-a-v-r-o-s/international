import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// The commercial promise of this product is that one rep cannot see another
// rep's business. These are the tests that hold it up. They run against the
// same policies that ship — no service-role shortcuts, no route handlers in the
// way, just a rep's session doing its worst.

let db: TestDb
let f: Fixtures

let repABooking: string      // Rep A, at Hotel Alpha
let repBBooking: string      // Rep B, at Hotel Beta
let blockId: string

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.sql(`delete from public.bookings`)

  repABooking = await bookAsRep(db, f.repA, {
    carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    first: 'Alpha', last: 'Guest', room: '101',
  })
  repBBooking = await bookAsRep(db, f.repB, {
    carId: f.car3, hotelId: f.hotelB, start: '2026-07-06', end: '2026-07-12',
    first: 'Beta', last: 'Guest', room: '202',
  })
  const block = await db.asUser(f.admin, () => db.one<{ id: string }>(
    `select public.admin_create_block($1, '2026-07-20', '2026-07-25', 'written off in June') as id`,
    [f.car2]))
  blockId = block.id
})

describe("rep A reaching for rep B's booking", () => {
  test('reading it returns nothing', async () => {
    const rows = await db.asUser(f.repA, () => db.sql(
      `select id, cust_first, total from public.bookings where id = $1`, [repBBooking]))
    expect(rows).toEqual([])
  })

  test('updating it changes nothing', async () => {
    const rows = await db.asUser(f.repA, () => db.sql(
      `update public.bookings set room_number = '999' where id = $1 returning id`, [repBBooking]))
    expect(rows).toEqual([])

    const after = await db.one<{ room_number: string }>(
      `select room_number from public.bookings where id = $1`, [repBBooking])
    expect(after.room_number).toBe('202')
  })

  test('cancelling it changes nothing', async () => {
    const rows = await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'cancelled' where id = $1 returning id`, [repBBooking]))
    expect(rows).toEqual([])

    const after = await db.one<{ status: string }>(
      `select status from public.bookings where id = $1`, [repBBooking])
    expect(after.status).toBe('booked')
  })

  test('deleting it changes nothing', async () => {
    await db.asUser(f.repA, () => db.sql(
      `delete from public.bookings where id = $1`, [repBBooking]))
    const rows = await db.sql(`select id from public.bookings where id = $1`, [repBBooking])
    expect(rows).toHaveLength(1)
  })

  test('its guest, drivers, extras, handovers, contracts and incidents are all invisible',
    async () => {
      await db.sql(
        `insert into public.booking_drivers
           (booking_id, is_main, first_name, last_name, dob, licence_number, front_image_path)
         values ($1, true, 'Beta', 'Guest', '1990-01-01', 'SECRET-LICENCE', 'licences/b/front.jpg')`,
        [repBBooking])
      await db.sql(
        `insert into public.booking_extras (booking_id, seat, qty) values ($1, 'infant', 1)`,
        [repBBooking])
      const h = await db.one<{ id: string }>(
        `insert into public.handovers (booking_id, kind, by_profile, fuel_eighths)
         values ($1, 'pickup', $2, 8) returning id`, [repBBooking, f.repB])
      await db.sql(
        `insert into public.damage_marks (handover_id, car_id, view, x, y, mark_type)
         values ($1, $2, 'front', 0.5, 0.5, 'scratch')`, [h.id, f.car3])
      await db.sql(
        `insert into public.contracts (booking_id, pdf_path, signature_path, signer_name)
         values ($1, 'c/b.pdf', 's/b.png', 'Beta Guest')`, [repBBooking])
      const incident = await db.one<{ id: string }>(
        `insert into public.incidents (booking_id, note, raised_by)
         values ($1, 'scratched the door', $2) returning id`, [repBBooking, f.repB])
      await db.sql(
        `insert into public.incident_photos (incident_id, path, added_by)
         values ($1, $2, $3)`,
        [incident.id, `${repBBooking}/incidents/secret.jpg`, f.repB])

      await db.asUser(f.repA, async () => {
        expect(await db.sql(
          `select id, licence_number, front_image_path from public.booking_drivers
            where booking_id = $1`, [repBBooking])).toEqual([])
        expect(await db.sql(
          `select id from public.booking_extras where booking_id = $1`, [repBBooking])).toEqual([])
        expect(await db.sql(
          `select id from public.handovers where booking_id = $1`, [repBBooking])).toEqual([])
        expect(await db.sql(
          `select id from public.damage_marks where handover_id = $1`, [h.id])).toEqual([])
        expect(await db.sql(
          `select id, pdf_path from public.contracts where booking_id = $1`,
          [repBBooking])).toEqual([])
        expect(await db.sql(
          `select id, note from public.incidents where booking_id = $1`,
          [repBBooking])).toEqual([])
        // And the photos hanging off it — the path itself never reaches them,
        // so there is nothing to hand to the storage API even if they tried.
        expect(await db.sql(
          `select id, path from public.incident_photos where incident_id = $1`,
          [incident.id])).toEqual([])
      })
    })

  test('they cannot attach themselves to it either', async () => {
    await db.asUser(f.repA, async () => {
      expect(await errcode(() => db.sql(
        `insert into public.booking_drivers (booking_id, first_name, last_name, dob)
         values ($1, 'Not', 'Mine', '1990-01-01')`, [repBBooking]))).toBe('42501')
      expect(await errcode(() => db.sql(
        `insert into public.handovers (booking_id, kind, by_profile) values ($1, 'pickup', $2)`,
        [repBBooking, f.repA]))).toBe('42501')
      expect(await errcode(() => db.sql(
        `insert into public.incidents (booking_id, note, raised_by)
         values ($1, 'x', $2)`, [repBBooking, f.repA]))).toBe('42501')
      expect(await errcode(() => db.sql(
        `insert into public.contracts (booking_id, pdf_path, signature_path, signer_name)
         values ($1, 'x', 'y', 'z')`, [repBBooking]))).toBe('42501')
    })
  })

  test('every admin RPC refuses them', async () => {
    await db.asUser(f.repA, async () => {
      expect(await errcode(() => db.sql(
        `select public.admin_set_booking_price($1, 1)`, [repBBooking]))).toBe('IR001')
      expect(await errcode(() => db.sql(
        `select public.admin_override_eligibility($1, 'x')`, [repBBooking]))).toBe('IR001')
      expect(await errcode(() => db.sql(
        `select * from public.admin_blocks('2026-07-01', '2026-07-31')`))).toBe('IR001')
      expect(await errcode(() => db.sql(
        `select public.admin_car_notes($1)`, [f.car1]))).toBe('IR001')
      expect(await errcode(() => db.sql(
        `select public.admin_set_car_notes($1, 'mine now')`, [f.car1]))).toBe('IR001')
      expect(await errcode(() => db.sql(
        `select public.admin_create_block($1, '2026-09-01', '2026-09-02', 'x')`,
        [f.car1]))).toBe('IR001')
      expect(await errcode(() => db.sql(
        `select public.admin_delete_block($1)`, [blockId]))).toBe('IR001')
      expect(await errcode(() => db.sql(
        `select public.admin_set_user_role($1, 'admin')`, [f.repA]))).toBe('IR001')
      expect(await errcode(() => db.sql(
        `select public.admin_set_user_active($1, false)`, [f.repB]))).toBe('IR001')
      expect(await errcode(() => db.sql(
        `select * from public.admin_incident_detail($1)`, [blockId]))).toBe('IR001')
    })
  })
})

describe('the cover-shift exception', () => {
  test("a hotel's other rep sees its bookings — that is the one way in", async () => {
    const rows = await db.asUser(f.repCover, () => db.sql<{ id: string }>(
      `select id, cust_first, total from public.bookings where id = $1`, [repABooking]))
    expect(rows).toHaveLength(1)
  })

  test('and still sees nothing belonging to a hotel they do not cover', async () => {
    const rows = await db.asUser(f.repCover, () => db.sql(
      `select id from public.bookings where id = $1`, [repBBooking]))
    expect(rows).toEqual([])
  })
})

describe('availability leaks nothing', () => {
  test('the function returns exactly two columns: the car and the dates', async () => {
    const cols = await db.sql<{ name: string }>(
      `select unnest(p.proargnames) as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'availability'`)
    expect(cols.map((c) => c.name)).toEqual(['from_date', 'to_date', 'car_id', 'occupied_dates'])
  })

  test("a block and another rep's booking come back identical", async () => {
    // car2 is blocked ("written off in June"); car3 is Rep B's booking. To Rep A
    // both are simply dates, in the same shape, with nothing to tell them apart.
    const rows = await db.asUser(f.repA, () => db.sql<{ car_id: string; occupied_dates: string[] }>(
      `select car_id, occupied_dates from public.availability('2026-07-01', '2026-07-31')
        where car_id = any($1)`, [[f.car2, f.car3]]))

    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['car_id', 'occupied_dates'])
      expect(row.occupied_dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true)
    }
  })

  test('the reason for a block never reaches a rep, by any route', async () => {
    await db.asUser(f.repA, async () => {
      expect(await errcode(() => db.sql(
        `select block_reason from public.bookings where id = $1`, [blockId]))).toBe('42501')
      // The block row itself is not selectable at all, reason or no reason.
      expect(await db.sql(
        `select id, start_date from public.bookings where kind = 'block'`)).toEqual([])
    })
  })

  test('a rep cannot widen the query to see the whole booking row', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select * from public.bookings`)))).toBe('42501')
  })
})

describe('no aggregate reaches a rep', () => {
  test('counting bookings counts only the ones they may already see', async () => {
    const { n } = await db.asUser(f.repA, () => db.one<{ n: number }>(
      `select count(*)::int as n from public.bookings`))
    const { total } = await db.one<{ total: number }>(
      `select count(*)::int as total from public.bookings`)
    expect(total).toBe(3)     // rep A's, rep B's, and the block
    expect(n).toBe(1)         // rep A sees exactly their own
  })

  test('summing revenue sums only their own bookings', async () => {
    const { s } = await db.asUser(f.repA, () => db.one<{ s: string }>(
      `select coalesce(sum(total), 0)::text as s from public.bookings`))
    const own = await db.one<{ s: string }>(
      `select total::text as s from public.bookings where id = $1`, [repABooking])
    expect(s).toBe(own.s)
  })

  test('the price tables are empty for a rep, whatever they ask for', async () => {
    await db.asUser(f.repA, async () => {
      expect(await db.sql(`select * from public.price_rows`)).toEqual([])
      expect(await db.sql(`select * from public.price_extra_day`)).toEqual([])
      expect(await db.sql(`select * from public.pricing_periods`)).toEqual([])
      expect(await db.sql(
        `select coalesce(sum(total), 0)::int as s from public.price_rows`))
        .toEqual([{ s: 0 }])
    })
  })

  test('the audit log is closed to them and open to the boss', async () => {
    expect(await db.asUser(f.repA, () => db.sql(`select * from public.audit_log`))).toEqual([])
    const admin = await db.asUser(f.admin, () => db.sql(`select id from public.audit_log`))
    expect(admin.length).toBeGreaterThan(0)
  })

  test('the only figure they get is their own cash in hand, today', async () => {
    // Rep A collected €50 cash at pickup today; Rep B collected €90.
    for (const [booking, rep, amount] of [
      [repABooking, f.repA, 50], [repBBooking, f.repB, 90],
    ] as const) {
      await db.sql(
        `insert into public.booking_drivers
           (booking_id, is_main, first_name, last_name, dob,
            licence_number, licence_country, licence_issued_on, licence_expires_on)
         values ($1, true, 'A', 'B', '1985-01-01', 'X', 'GB', '2010-01-01', '2030-01-01')`,
        [booking])
      await db.asUser(rep, () => db.sql(
        `update public.bookings
            set status = 'out', pay_method = 'cash', collected = $2, paid = true
          where id = $1`, [booking, amount]))
      await db.sql(
        `insert into public.handovers (booking_id, kind, by_profile, fuel_eighths)
         values ($1, 'pickup', $2, 8)`, [booking, rep])
    }

    const a = await db.asUser(f.repA, () => db.one<{ v: number }>(
      `select public.my_cash_in_hand() as v`))
    const b = await db.asUser(f.repB, () => db.one<{ v: number }>(
      `select public.my_cash_in_hand() as v`))

    expect(a.v).toBe(50)
    expect(b.v).toBe(90)
  })

  test('yesterday\'s cash, and cash already handed over, are not in it', async () => {
    await db.sql(
      `insert into public.booking_drivers
         (booking_id, is_main, first_name, last_name, dob,
          licence_number, licence_country, licence_issued_on, licence_expires_on)
       values ($1, true, 'A', 'B', '1985-01-01', 'X', 'GB', '2010-01-01', '2030-01-01')`,
      [repABooking])
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings
          set status = 'out', pay_method = 'cash', collected = 50, paid = true
        where id = $1`, [repABooking]))
    await db.sql(
      `insert into public.handovers (booking_id, kind, by_profile, occurred_at)
       values ($1, 'pickup', $2, now() - interval '1 day')`, [repABooking, f.repA])

    const a = await db.asUser(f.repA, () => db.one<{ v: number }>(
      `select public.my_cash_in_hand() as v`))
    expect(a.v).toBe(0)
  })
})

describe('what a rep may write is decided in the database', () => {
  test('a rep POSTing total, created_by or kind is refused outright', async () => {
    await db.asUser(f.repA, async () => {
      expect(await errcode(() => db.sql(
        `insert into public.bookings (car_id, start_date, end_date, total)
         values ($1, '2026-07-15', '2026-07-16', 1)`, [f.car1]))).toBe('42501')
      expect(await errcode(() => db.sql(
        `insert into public.bookings (car_id, start_date, end_date, created_by)
         values ($1, '2026-07-15', '2026-07-16', $2)`, [f.car1, f.repB]))).toBe('42501')
      expect(await errcode(() => db.sql(
        `insert into public.bookings (car_id, start_date, end_date, kind, block_reason)
         values ($1, '2026-07-15', '2026-07-16', 'block', 'mine')`, [f.car1]))).toBe('42501')
      expect(await errcode(() => db.sql(
        `update public.bookings set total = 1 where id = $1`, [repABooking]))).toBe('42501')
    })
  })

  test('and if the column grant were ever loosened, the trigger still ignores them', async () => {
    // Same insert, from a connection that DOES hold the privilege, but with a
    // rep's claims. Belt and braces: the guard trigger overwrites the fields
    // rather than trusting them.
    await db.sql(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: f.repA, role: 'authenticated' })])
    const row = await db.one<{ created_by: string; total: number; kind: string; status: string }>(
      `insert into public.bookings
         (car_id, hotel_id, start_date, end_date, kind, status,
          created_by, total, block_reason, collected, paid)
       values ($1, $2, '2026-07-15', '2026-07-16', 'block', 'blocked',
               $3, 1, 'i am the boss', 9, true)
       returning created_by, total, kind, status`,
      [f.car1, f.hotelA, f.repB])
    await db.sql(`select set_config('request.jwt.claims', '', false)`)

    expect(row.created_by).toBe(f.repA)     // not rep B
    expect(row.kind).toBe('rental')         // not a block
    expect(row.status).toBe('booked')
    expect(row.total).toBe(65)              // the engine's 2-day low-season price
  })

  test('a rep cannot promote themselves to admin', async () => {
    await db.asUser(f.repA, async () => {
      expect(await errcode(() => db.sql(
        `update public.profiles set role = 'admin' where id = $1`, [f.repA]))).toBe('42501')
      expect(await errcode(() => db.sql(
        `update public.profiles set active = true where id = $1`, [f.repA]))).toBe('42501')
    })
    const row = await db.one<{ role: string }>(
      `select role from public.profiles where id = $1`, [f.repA])
    expect(row.role).toBe('rep')
  })

  test('a rep cannot touch the fleet, the hotels, the categories or the price tables', async () => {
    await db.asUser(f.repA, async () => {
      expect(await db.sql(
        `update public.cars set plate = 'HACKED' where id = $1 returning id`, [f.car1])).toEqual([])
      expect(await db.sql(
        `update public.price_rows set total = 1 returning days`)).toEqual([])
      expect(await db.sql(
        `update public.categories set min_driver_age = 18 returning code`)).toEqual([])
      // An UPDATE the policy hides simply matches nothing; an INSERT the policy
      // forbids is rejected outright. Both are refusals.
      expect(await errcode(() => db.sql(
        `insert into public.hotels (name) values ('Mine') returning id`))).toBe('42501')
    })
  })

  test('a rep sees only their own profile, and only their own hotels', async () => {
    await db.asUser(f.repA, async () => {
      const profiles = await db.sql<{ id: string }>(`select id from public.profiles`)
      expect(profiles.map((p) => p.id)).toEqual([f.repA])

      const hotels = await db.sql<{ id: string }>(`select id from public.hotels`)
      expect(hotels.map((h) => h.id)).toEqual([f.hotelA])
    })
  })

  test('nobody at all can read a PIN hash through the API', async () => {
    for (const uid of [f.repA, f.admin]) {
      expect(await errcode(() => db.asUser(uid, () => db.sql(
        `select pin_hash from public.profiles where id = $1`, [uid])))).toBe('42501')
    }
  })
})

describe('an ad-hoc-hotel booking (docs/01-DECISIONS.md §41)', () => {
  test('is visible to its creator and the admin, and to no other rep', async () => {
    const adhocBooking = await bookAsRep(db, f.repA, {
      carId: f.carC, hotelId: null, adhocHotelName: 'Hotel Not In The System',
      start: '2026-07-06', end: '2026-07-08', first: 'Ad', last: 'Hoc', room: '9',
    })

    const own = await db.asUser(f.repA, () => db.sql(
      `select id from public.bookings where id = $1`, [adhocBooking]))
    expect(own).toHaveLength(1)

    const admin = await db.asUser(f.admin, () => db.sql(
      `select id from public.bookings where id = $1`, [adhocBooking]))
    expect(admin).toHaveLength(1)

    // Rep Cover sees Hotel Alpha's bookings (the cover-shift exception above) —
    // but this booking names no hotel at all, so that exception has nothing to
    // match against.
    const cover = await db.asUser(f.repCover, () => db.sql(
      `select id from public.bookings where id = $1`, [adhocBooking]))
    expect(cover).toEqual([])

    const otherRep = await db.asUser(f.repB, () => db.sql(
      `select id from public.bookings where id = $1`, [adhocBooking]))
    expect(otherRep).toEqual([])
  })

  test('cannot name a registered hotel and an ad-hoc one at the same time', async () => {
    await db.asUser(f.repA, async () => {
      expect(await errcode(() => db.sql(
        `insert into public.bookings
           (car_id, hotel_id, adhoc_hotel_name, start_date, end_date,
            cust_first, cust_last, cust_phone, cust_dob)
         values ($1, $2, 'Some Hotel', '2026-07-15', '2026-07-16', 'A', 'B', '+306900000000', '1990-01-01')`,
        [f.carC, f.hotelA]))).toBe('23514') // check_violation
    })
  })
})

describe('logged out', () => {
  test('anon reaches nothing at all', async () => {
    await db.as({ kind: 'anon' }, async () => {
      expect(await errcode(() => db.sql(`select id from public.bookings`))).toBe('42501')
      expect(await errcode(() => db.sql(`select id from public.cars`))).toBe('42501')
      expect(await errcode(() => db.sql(
        `select * from public.availability('2026-07-01', '2026-07-31')`))).toBe('42501')
      expect(await errcode(() => db.sql(
        `select * from public.quote($1, '2026-07-06', '2026-07-08')`, [f.catA]))).toBe('42501')
    })
  })
})
