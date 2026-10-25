import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// Pay after (docs/01-DECISIONS.md §47). A rep picks one option; the database
// decides whether it is on offer and how much has to change hands first. The
// boss then settles the rest, Paid or Gratis, and only money that came in is
// income.

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

const PHONE = '+306911111111'

/** A rental with its driver and pickup handover in place, still `booked`. */
async function readyForPickup(start: string, end: string, carId = f.car1) {
  const id = await bookAsRep(db, f.repA, { carId, hotelId: f.hotelA, start, end, phone: PHONE })
  await db.asUser(f.repA, () => db.sql(
    `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob,
       licence_number, licence_country, licence_issued_on, licence_expires_on)
     values ($1, true, 'A', 'B', '1985-01-01', 'X', 'GR', '2010-01-01', '2032-01-01')`, [id]))
  await db.asUser(f.repA, () => db.sql(
    `insert into public.handovers (booking_id, kind, by_profile, fuel_eighths)
     values ($1, 'pickup', $2, 8)`, [id, f.repA]))
  return id
}

function pickUpPayingAfter(id: string, collected: number, method: 'cash' | 'card' | null = 'cash') {
  return db.asUser(f.repA, () => db.sql(
    `update public.bookings
        set pay_after = true, collected = $2, pay_method = $3::public.pay_method, status = 'out'
      where id = $1`, [id, collected, method]))
}

/** An earlier rental by the same phone that went out and came back. */
async function pastRental() {
  const id = await readyForPickup('2026-06-02', '2026-06-04', f.car2)
  await db.asUser(f.repA, () => db.sql(
    `update public.bookings set collected = 65, pay_method = 'cash', paid = true, status = 'out' where id = $1`, [id]))
  await db.asUser(f.admin, () => db.sql(`update public.bookings set status = 'returned' where id = $1`, [id]))
}

const upfront = (id: string) =>
  db.asUser(f.repA, () => db.one<{ v: number | null }>(`select public.pay_after_upfront($1) as v`, [id]))
    .then((r) => r.v)

describe('what the rep is allowed', () => {
  test('a first-time guest pays the 1-day list price in cash first', async () => {
    const id = await readyForPickup('2026-07-06', '2026-07-08')   // cat A, low: 1d 35, 3d 90
    expect(await upfront(id)).toBe(35)
    expect(await errcode(() => pickUpPayingAfter(id, 0))).toBe('IR125')
    expect(await errcode(() => pickUpPayingAfter(id, 34))).toBe('IR125')
    await pickUpPayingAfter(id, 35)
    const row = await db.one<{ status: string; paid: boolean }>(`select status, paid from public.bookings where id = $1`, [id])
    expect(row).toEqual({ status: 'out', paid: false })
  })

  test('a first-time guest on a 1-day rental cannot pay after at all', async () => {
    const id = await readyForPickup('2026-07-06', '2026-07-06')
    expect(await upfront(id)).toBeNull()
    expect(await errcode(() => pickUpPayingAfter(id, 0))).toBe('IR124')
  })

  test('a returning guest may take the car with nothing paid, even for one day', async () => {
    await pastRental()
    const id = await readyForPickup('2026-07-06', '2026-07-06')
    expect(await upfront(id)).toBe(0)
    await pickUpPayingAfter(id, 0, null)
    expect((await db.one<{ status: string }>(`select status from public.bookings where id = $1`, [id])).status).toBe('out')
  })

  test('never by card, and never with nothing left to owe', async () => {
    await pastRental()
    const id = await readyForPickup('2026-07-06', '2026-07-08')
    expect(await errcode(() => pickUpPayingAfter(id, 35, 'card'))).toBe('IR123')
    expect(await errcode(() => pickUpPayingAfter(id, 90))).toBe('IR123')
  })

  test('once the car is out a rep cannot undo the choice, and never sees the settlement', async () => {
    const id = await readyForPickup('2026-07-06', '2026-07-08')
    await pickUpPayingAfter(id, 35)
    await db.asUser(f.repA, () => db.sql(`update public.bookings set pay_after = false where id = $1`, [id]))
    expect((await db.one<{ pay_after: boolean }>(`select pay_after from public.bookings where id = $1`, [id])).pay_after).toBe(true)

    expect(await errcode(() => db.asUser(f.repA, () =>
      db.sql(`select settlement from public.bookings where id = $1`, [id])))).toBe('42501')
    expect(await errcode(() => db.asUser(f.repA, () =>
      db.sql(`select public.admin_settle_pay_after($1, 'gratis', null)`, [id])))).not.toBe('no-code')
    expect(await errcode(() => db.asUser(f.repA, () =>
      db.sql(`select * from public.admin_open_pay_after()`)))).not.toBe('no-code')
  })
})

describe('what the boss sees and settles', () => {
  const today = () => db.one<{ d: string }>(`select app.today()::text as d`).then((r) => r.d)
  const summary = async () => {
    const d = await today()
    return db.asUser(f.admin, () => db.one<{ cash: number; card: number; gratis: number }>(
      `select * from public.admin_money_summary($1, $1)`, [d]))
  }
  const open = () => db.asUser(f.admin, () =>
    db.sql<{ booking_id: string; balance: number; rep_id: string }>(`select * from public.admin_open_pay_after()`))

  test('only money received is income; the open balance waits on its own list', async () => {
    const id = await readyForPickup('2026-07-06', '2026-07-08')
    await pickUpPayingAfter(id, 35)

    expect(await summary()).toEqual({ cash: 35, card: 0, gratis: 0 })
    expect(await open()).toEqual([expect.objectContaining({ booking_id: id, balance: 55, rep_id: f.repA })])

    await db.asUser(f.admin, () => db.sql(`select public.admin_settle_pay_after($1, 'paid', 'card')`, [id]))
    expect(await summary()).toEqual({ cash: 35, card: 55, gratis: 0 })
    expect(await open()).toEqual([])
  })

  test('gratis closes the balance without counting it as income, once only', async () => {
    const id = await readyForPickup('2026-07-06', '2026-07-08')
    await pickUpPayingAfter(id, 35)

    await db.asUser(f.admin, () => db.sql(`select public.admin_settle_pay_after($1, 'gratis', null)`, [id]))
    expect(await summary()).toEqual({ cash: 35, card: 0, gratis: 55 })
    expect(await open()).toEqual([])
    // Reads as settled anywhere `paid` is shown (§48); only A14 unlocked tells them apart.
    expect((await db.one<{ paid: boolean }>(`select paid from public.bookings where id = $1`, [id])).paid).toBe(true)
    expect(await errcode(() => db.asUser(f.admin, () =>
      db.sql(`select public.admin_settle_pay_after($1, 'paid', 'cash')`, [id])))).toBe('IR126')
  })

  test('paid needs a method and gratis refuses one', async () => {
    const id = await readyForPickup('2026-07-06', '2026-07-08')
    await pickUpPayingAfter(id, 35)
    for (const [outcome, method] of [['paid', null], ['gratis', 'cash'], ['paid', 'transfer']] as const) {
      expect(await errcode(() => db.asUser(f.admin, () =>
        db.sql(`select public.admin_settle_pay_after($1, $2, $3::public.pay_method)`, [id, outcome, method])))).toBe('IR104')
    }
  })
})

describe('the gratis code (§48)', () => {
  test('its hash is out of reach of every signed-in user, the boss included', async () => {
    await db.sql(`insert into public.gratis_lock (code_hash) values ('x') on conflict (id) do nothing`)
    for (const who of [f.admin, f.repA]) {
      expect(await errcode(() => db.asUser(who, () => db.sql(`select code_hash from public.gratis_lock`)))).toBe('42501')
    }
  })
})

describe('waived rentals on a locked manager browser (§48)', () => {
  const hiddenIds = () => db.asUser(f.admin, () =>
    db.sql<{ id: string }>(`select public.admin_hidden_waived_ids() as id`)).then((r) => r.map((x) => x.id))

  test('hidden once waived AND returned, never while the car is still out', async () => {
    const id = await readyForPickup('2026-07-06', '2026-07-08')
    await pickUpPayingAfter(id, 35)
    await db.asUser(f.admin, () => db.sql(`select public.admin_settle_pay_after($1, 'gratis', null)`, [id]))
    expect(await hiddenIds()).toEqual([])

    await db.asUser(f.admin, () => db.sql(`update public.bookings set status = 'returned' where id = $1`, [id]))
    expect(await hiddenIds()).toEqual([id])
  })

  test('a paid balance is never hidden, and a rep cannot ask', async () => {
    const id = await readyForPickup('2026-07-06', '2026-07-08')
    await pickUpPayingAfter(id, 35)
    await db.asUser(f.admin, () => db.sql(`select public.admin_settle_pay_after($1, 'paid', 'cash')`, [id]))
    await db.asUser(f.admin, () => db.sql(`update public.bookings set status = 'returned' where id = $1`, [id]))
    expect(await hiddenIds()).toEqual([])
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(`select public.admin_hidden_waived_ids()`)))).not.toBe('no-code')
  })
})
