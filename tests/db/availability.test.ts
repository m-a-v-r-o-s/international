import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

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

/** Occupied dates for one car, as availability() reports them to a rep. */
async function occupied(carId: string, from: string, to: string, as = f.repA): Promise<string[]> {
  return db.asUser(as, async () => {
    const rows = await db.sql<{ car_id: string; occupied_dates: string[] }>(
      `select car_id, occupied_dates from public.availability($1, $2) where car_id = $3`,
      [from, to, carId])
    return rows[0]?.occupied_dates ?? []
  })
}

describe('the day rule', () => {
  test('a booking holds the car through the whole of its final date', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-12', end: '2026-07-15',
    })

    expect(await occupied(f.car1, '2026-07-10', '2026-07-20')).toEqual([
      '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15',
    ])
  })

  test('Mon pickup to Wed return is three days, not two', async () => {
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-13', end: '2026-07-15',
    })
    const row = await db.one<{ days: number }>(
      `select days from public.bookings where id = $1`, [id])
    expect(row.days).toBe(3)
  })

  test('a single-day rental is one day and holds exactly one date', async () => {
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-12', end: '2026-07-12',
    })
    const row = await db.one<{ days: number }>(
      `select days from public.bookings where id = $1`, [id])
    expect(row.days).toBe(1)
    expect(await occupied(f.car1, '2026-07-01', '2026-07-31')).toEqual(['2026-07-12'])
  })
})

describe('the exclusion constraint', () => {
  test('adjacent bookings are legal: 12–15 Jul then 16–18 Jul', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-12', end: '2026-07-15',
    })
    await expect(bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-16', end: '2026-07-18',
    })).resolves.toBeTruthy()
  })

  test('touching bookings are rejected by the database: 12–15 Jul then 15–18 Jul', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-12', end: '2026-07-15',
    })
    const code = await errcode(() => bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-15', end: '2026-07-18',
    }))
    expect(code).toBe('23P01')   // exclusion_violation
  })

  test.each([
    ['full containment',        '2026-07-13', '2026-07-14'],
    ['containing the existing', '2026-07-10', '2026-07-20'],
    ['overlap at the start',    '2026-07-10', '2026-07-12'],
    ['overlap at the end',      '2026-07-15', '2026-07-20'],
    ['identical range',         '2026-07-12', '2026-07-15'],
    ['one day inside',          '2026-07-14', '2026-07-14'],
  ])('%s is rejected', async (_label, start, end) => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-12', end: '2026-07-15',
    })
    const code = await errcode(() => bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start, end,
    }))
    expect(code).toBe('23P01')
  })

  test('the same dates on a different car are fine', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-12', end: '2026-07-15',
    })
    await expect(bookAsRep(db, f.repB, {
      carId: f.car2, hotelId: f.hotelB, start: '2026-07-12', end: '2026-07-15',
    })).resolves.toBeTruthy()
  })

  test('two transactions racing for the last car: exactly one wins', async () => {
    const a = await db.connect()
    const b = await db.connect()

    const start = async (client: typeof a, rep: string) => {
      await client.query('begin')
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: rep, role: 'authenticated' })])
      await client.query('set local role authenticated')
      return client.query(
        `insert into public.bookings (car_id, hotel_id, start_date, end_date,
                                      cust_first, cust_last, cust_phone, cust_dob)
         values ($1, $2, '2026-07-20', '2026-07-24', 'Racer', 'One', '+30690', '1990-01-01')`,
        [f.car1, f.hotelA])
    }

    // A gets in first and holds the gist lock; B blocks on it until A commits.
    await start(a, f.repA)
    const bInsert = start(b, f.repB).then(
      async () => { await b.query('commit'); return 'won' as const },
      async () => { await b.query('rollback'); return 'lost' as const })

    await a.query('commit')
    const bResult = await bInsert

    expect(bResult).toBe('lost')

    const { rows } = await a.query(
      `select count(*)::int as n from public.bookings where car_id = $1`, [f.car1])
    expect(rows[0].n).toBe(1)

    await a.end()
    await b.end()
  })
})

describe('blocks', () => {
  test('a block occupies dates exactly like a booking', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_create_block($1, '2026-07-12', '2026-07-15', 'gearbox')`, [f.car1]))

    expect(await occupied(f.car1, '2026-07-10', '2026-07-20')).toEqual([
      '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15',
    ])
  })

  test('a booking overlapping a block is rejected', async () => {
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_create_block($1, '2026-07-12', '2026-07-15', 'gearbox')`, [f.car1]))

    const code = await errcode(() => bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-14', end: '2026-07-18',
    }))
    expect(code).toBe('23P01')
  })

  test('a block overlapping an existing booking is rejected', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-12', end: '2026-07-15',
    })
    const code = await errcode(() => db.asUser(f.admin, () => db.sql(
      `select public.admin_create_block($1, '2026-07-15', '2026-07-16', 'service')`, [f.car1])))
    expect(code).toBe('23P01')
  })

  test('releasing a block reopens the dates', async () => {
    const { id } = await db.asUser(f.admin, () => db.one<{ id: string }>(
      `select public.admin_create_block($1, '2026-07-12', '2026-07-15', 'service') as id`,
      [f.car1]))

    await db.asUser(f.admin, () => db.sql(`select public.admin_delete_block($1)`, [id]))
    expect(await occupied(f.car1, '2026-07-10', '2026-07-20')).toEqual([])
  })
})

describe('what frees a car', () => {
  test('an early return frees the remaining dates and does not change the price', async () => {
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-10', end: '2026-07-20',
    })
    await addDriver(id)

    const before = await db.one<{ total: number; days: number }>(
      `select total, days from public.bookings where id = $1`, [id])

    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'out' where id = $1`, [id]))
    // The guest brings it back on the 14th, six days early.
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = 'returned' where id = $1`, [id]))

    expect(await occupied(f.car1, '2026-07-01', '2026-07-31')).toEqual([])

    const after = await db.one<{ total: number; days: number }>(
      `select total, days from public.bookings where id = $1`, [id])
    expect(after.total).toBe(before.total)
    expect(after.days).toBe(before.days)

    // …and the car can be re-let immediately, with no turnaround gap.
    await expect(bookAsRep(db, f.repB, {
      carId: f.car1, hotelId: f.hotelB, start: '2026-07-15', end: '2026-07-18',
    })).resolves.toBeTruthy()
  })

  test.each(['cancelled', 'no_show'])('a %s booking frees its dates', async (status) => {
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-12', end: '2026-07-15',
    })
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set status = $2 where id = $1`, [id, status]))

    expect(await occupied(f.car1, '2026-07-10', '2026-07-20')).toEqual([])
    await expect(bookAsRep(db, f.repB, {
      carId: f.car1, hotelId: f.hotelB, start: '2026-07-12', end: '2026-07-15',
    })).resolves.toBeTruthy()
  })
})

describe('availability()', () => {
  test('archived cars never appear', async () => {
    const rows = await db.asUser(f.repA, () => db.sql<{ car_id: string }>(
      `select car_id from public.availability('2026-07-01', '2026-07-31')`))
    const ids = rows.map((r) => r.car_id)
    expect(ids).toContain(f.car1)
    expect(ids).not.toContain(f.archived)
  })

  test('a free car comes back with an empty date list, not a missing row', async () => {
    const rows = await db.asUser(f.repA, () => db.sql<{ occupied_dates: string[] }>(
      `select occupied_dates from public.availability('2026-07-01', '2026-07-31')
       where car_id = $1`, [f.car2]))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.occupied_dates).toEqual([])
  })

  test('dates are clipped to the window asked for', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-01', end: '2026-07-31',
    })
    expect(await occupied(f.car1, '2026-07-14', '2026-07-16')).toEqual([
      '2026-07-14', '2026-07-15', '2026-07-16',
    ])
  })

  test('overlapping holds on one car do not produce duplicate dates', async () => {
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-12', end: '2026-07-15',
    })
    await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-16', end: '2026-07-18',
    })
    const dates = await occupied(f.car1, '2026-07-01', '2026-07-31')
    expect(new Set(dates).size).toBe(dates.length)
    expect(dates).toHaveLength(7)
  })

  test('a backwards or oversized range is refused', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select * from public.availability('2026-07-10', '2026-07-01')`)))).toBe('IR104')
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select * from public.availability('2026-01-01', '2030-01-01')`)))).toBe('IR105')
  })

  test('a deactivated rep gets nothing back', async () => {
    expect(await errcode(() => db.asUser(f.inactive, () => db.sql(
      `select * from public.availability('2026-07-01', '2026-07-31')`)))).toBe('IR001')
  })
})

/** Pickups need an eligible driver on the booking; this is the plain, valid one. */
async function addDriver(bookingId: string): Promise<void> {
  await db.sql(
    `insert into public.booking_drivers
       (booking_id, is_main, first_name, last_name, dob,
        licence_number, licence_country, licence_issued_on, licence_expires_on)
     values ($1, true, 'Anna', 'Visitor', '1985-04-02',
             'X1', 'GB', '2010-05-01', '2030-05-01')`,
    [bookingId])
}
