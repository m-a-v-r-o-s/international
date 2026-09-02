import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// R1's footer strip — today's own cash in hand, and handing it over.
//
// This is the ONE aggregate a rep may see (docs/01-DECISIONS.md §7), so the
// tests here are as much about what the number must NOT include as about the
// arithmetic: nobody else's cash, no card or transfer takings, nothing from a
// booking that has not been picked up, and nothing already handed over.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.sql(`delete from public.bookings`)
  await db.sql(`delete from public.cash_handovers`)
})

/**
 * A rental picked up TODAY and paid for. The pickup handover's occurred_at is
 * what my_cash_in_hand() measures, in Athens time, so it is left at its
 * default rather than back-dated unless a test says otherwise.
 */
async function pickedUpAndPaid(
  rep: string,
  carId: string,
  hotelId: string,
  opts: { amount: number; method: 'cash' | 'card' | 'transfer'; pickedUpDaysAgo?: number } ,
) {
  const bookingId = await bookAsRep(db, rep, {
    carId, hotelId, start: '2026-07-06', end: '2026-07-08',
  })
  await db.asUser(rep, () => db.sql(
    `insert into public.booking_drivers (booking_id, is_main, first_name, last_name, dob,
       licence_number, licence_country, licence_issued_on, licence_expires_on)
     values ($1, true, 'A', 'B', '1985-01-01', 'X', 'GR', '2010-01-01', '2032-01-01')`, [bookingId]))
  await db.asUser(rep, () => db.sql(
    `insert into public.handovers (booking_id, kind, by_profile, fuel_eighths)
     values ($1, 'pickup', $2, 8)`, [bookingId, rep]))

  if (opts.pickedUpDaysAgo) {
    await db.sql(
      `update public.handovers set occurred_at = now() - make_interval(days => $2)
       where booking_id = $1 and kind = 'pickup'`, [bookingId, opts.pickedUpDaysAgo])
  }

  await db.asUser(rep, () => db.sql(
    `update public.bookings
        set collected = $2, pay_method = $3::public.pay_method, paid = true, status = 'out'
      where id = $1`, [bookingId, opts.amount, opts.method]))

  return bookingId
}

const cashOf = (rep: string) =>
  db.asUser(rep, () => db.one<{ v: number }>(`select public.my_cash_in_hand() as v`)).then((r) => r.v)

const readyOf = (rep: string) =>
  db.asUser(rep, () => db.one<{ v: number }>(`select public.my_cash_ready_to_hand_over() as v`)).then((r) => r.v)

describe('the one aggregate a rep may see', () => {
  test('cash collected today on their own pickups, and nothing else', async () => {
    await pickedUpAndPaid(f.repA, f.car1, f.hotelA, { amount: 90, method: 'cash' })
    await pickedUpAndPaid(f.repA, f.car2, f.hotelA, { amount: 105, method: 'card' })

    expect(await cashOf(f.repA)).toBe(90)   // the card takings are not cash in hand
  })

  test('another rep\'s cash is never in it — not even a covering colleague\'s', async () => {
    await pickedUpAndPaid(f.repA, f.car1, f.hotelA, { amount: 90, method: 'cash' })
    await pickedUpAndPaid(f.repB, f.car3, f.hotelB, { amount: 40, method: 'cash' })

    expect(await cashOf(f.repA)).toBe(90)
    expect(await cashOf(f.repB)).toBe(40)
    // repCover covers Hotel Alpha and can READ repA's booking — but the money
    // is repA's, not the hotel's.
    expect(await cashOf(f.repCover)).toBe(0)
  })

  test('cash taken on an earlier day has already left the figure', async () => {
    await pickedUpAndPaid(f.repA, f.car1, f.hotelA, { amount: 90, method: 'cash', pickedUpDaysAgo: 2 })
    expect(await cashOf(f.repA)).toBe(0)
  })

  test('a booking not yet picked up contributes nothing — there is no handover', async () => {
    const bookingId = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set collected = 90, pay_method = 'cash', paid = true
       where id = $1`, [bookingId]))

    expect(await cashOf(f.repA)).toBe(0)
  })
})

describe('handing it over', () => {
  test('my_hand_over_cash() records the receipt but leaves the figure until the boss confirms it', async () => {
    await pickedUpAndPaid(f.repA, f.car1, f.hotelA, { amount: 90, method: 'cash' })
    await pickedUpAndPaid(f.repA, f.car2, f.hotelA, { amount: 35, method: 'cash' })
    expect(await cashOf(f.repA)).toBe(125)

    const handed = await db.asUser(f.repA, () => db.one<{ handover_id: string; amount: number }>(
      `select handover_id, amount from public.my_hand_over_cash()`))
    expect(handed.amount).toBe(125)

    // docs/01-DECISIONS.md §31: only the boss's confirmation clears this, so
    // a rep's own tap leaves their own figure exactly where it was — what
    // changes is that there is nothing left for a second tap to grab.
    expect(await cashOf(f.repA)).toBe(125)
    expect(await readyOf(f.repA)).toBe(0)

    const receipt = await db.one<{ rep_id: string; amount: number; confirmed_by: string | null }>(
      `select rep_id, amount, confirmed_by from public.cash_handovers where id = $1`,
      [handed.handover_id])
    expect(receipt.rep_id).toBe(f.repA)
    expect(receipt.amount).toBe(125)
    expect(receipt.confirmed_by).toBeNull()   // the boss confirms receipt himself

    // The receipt is linked to the bookings it actually covers, not just a sum.
    const covered = await db.sql<{ n: string }>(
      `select count(*) as n from public.bookings where cash_handover_id = $1`, [handed.handover_id])
    expect(Number(covered[0]?.n)).toBe(2)

    // And it is the boss, not the rep, whose action finally zeroes it.
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_confirm_cash_handover($1)`, [handed.handover_id]))
    expect(await cashOf(f.repA)).toBe(0)
  })

  test('cash taken AFTER a hand-over adds to the figure, on top of what is still awaiting confirmation', async () => {
    await pickedUpAndPaid(f.repA, f.car1, f.hotelA, { amount: 90, method: 'cash' })
    await db.asUser(f.repA, () => db.sql(`select public.my_hand_over_cash()`))
    expect(await cashOf(f.repA)).toBe(90)     // handed over, not yet confirmed
    expect(await readyOf(f.repA)).toBe(0)       // nothing left for a second tap

    // The rare case docs/01-DECISIONS.md §31 exists for: a night-shift pickup
    // or a delayed payment, after the usual end-of-morning hand-over.
    await pickedUpAndPaid(f.repA, f.car2, f.hotelA, { amount: 40, method: 'cash' })
    expect(await cashOf(f.repA)).toBe(130)
    expect(await readyOf(f.repA)).toBe(40)

    const handedAgain = await db.asUser(f.repA, () => db.one<{ amount: number }>(
      `select amount from public.my_hand_over_cash()`))
    expect(handedAgain.amount).toBe(40)   // only the new cash — the first batch is a separate receipt
    expect(await cashOf(f.repA)).toBe(130)      // still owed until the boss confirms either one
    expect(await readyOf(f.repA)).toBe(0)
  })

  test('handing over nothing is refused (IR114), not recorded as an empty receipt', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.my_hand_over_cash()`)))).toBe('IR114')

    const receipts = await db.sql(`select id from public.cash_handovers`)
    expect(receipts).toHaveLength(0)
  })

  test('a double-tap cannot hand the same cash over twice', async () => {
    await pickedUpAndPaid(f.repA, f.car1, f.hotelA, { amount: 90, method: 'cash' })
    await db.asUser(f.repA, () => db.sql(`select public.my_hand_over_cash()`))

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.my_hand_over_cash()`)))).toBe('IR114')

    const receipts = await db.sql(`select id from public.cash_handovers`)
    expect(receipts).toHaveLength(1)
    expect(await readyOf(f.repA)).toBe(0)
  })

  test('a rep can only ever hand over their OWN cash — the RPC takes no arguments', async () => {
    await pickedUpAndPaid(f.repA, f.car1, f.hotelA, { amount: 90, method: 'cash' })
    await pickedUpAndPaid(f.repB, f.car3, f.hotelB, { amount: 40, method: 'cash' })

    const handed = await db.asUser(f.repB, () => db.one<{ amount: number }>(
      `select amount from public.my_hand_over_cash()`))
    expect(handed.amount).toBe(40)

    expect(await cashOf(f.repA)).toBe(90)   // untouched
  })

  test('a rep sees only their own receipts', async () => {
    await pickedUpAndPaid(f.repA, f.car1, f.hotelA, { amount: 90, method: 'cash' })
    await pickedUpAndPaid(f.repB, f.car3, f.hotelB, { amount: 40, method: 'cash' })
    await db.asUser(f.repA, () => db.sql(`select public.my_hand_over_cash()`))
    await db.asUser(f.repB, () => db.sql(`select public.my_hand_over_cash()`))

    const seenByA = await db.asUser(f.repA, () => db.sql<{ amount: number }>(
      `select id, rep_id, amount, handed_at from public.cash_handovers`))
    expect(seenByA.map((r) => r.amount)).toEqual([90])

    const seenByAdmin = await db.asUser(f.admin, () => db.sql(
      `select id, rep_id, amount, handed_at from public.cash_handovers`))
    expect(seenByAdmin).toHaveLength(2)
  })

  test('the admin confirms receipt; a rep cannot confirm their own', async () => {
    await pickedUpAndPaid(f.repA, f.car1, f.hotelA, { amount: 90, method: 'cash' })
    const handed = await db.asUser(f.repA, () => db.one<{ handover_id: string }>(
      `select handover_id from public.my_hand_over_cash()`))
    expect(await cashOf(f.repA)).toBe(90)   // a rep confirming their own would zero it early — see below

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.admin_confirm_cash_handover($1)`, [handed.handover_id])))).toBe('IR001')
    expect(await cashOf(f.repA)).toBe(90)   // the refused attempt moved nothing

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_confirm_cash_handover($1)`, [handed.handover_id]))

    const after = await db.one<{ confirmed_by: string }>(
      `select confirmed_by from public.cash_handovers where id = $1`, [handed.handover_id])
    expect(after.confirmed_by).toBe(f.admin)
    expect(await cashOf(f.repA)).toBe(0)   // only the boss's confirmation clears it (docs/01-DECISIONS.md §31)
  })

  test('admin_pending_cash_handovers() lists what nobody has confirmed yet, and only for the admin', async () => {
    await pickedUpAndPaid(f.repA, f.car1, f.hotelA, { amount: 90, method: 'cash' })
    await pickedUpAndPaid(f.repB, f.car3, f.hotelB, { amount: 40, method: 'cash' })
    const handedA = await db.asUser(f.repA, () => db.one<{ handover_id: string }>(
      `select handover_id from public.my_hand_over_cash()`))
    await db.asUser(f.repB, () => db.sql(`select public.my_hand_over_cash()`))

    expect(await errcode(() => db.asUser(f.repA, () =>
      db.sql(`select * from public.admin_pending_cash_handovers()`)))).toBe('IR001')

    const pending = await db.asUser(f.admin, () => db.sql<{ id: string; rep_name: string; amount: number }>(
      `select id, rep_name, amount from public.admin_pending_cash_handovers()`))
    expect(pending).toHaveLength(2)
    expect(pending.map((r) => r.amount).sort()).toEqual([40, 90])

    // Confirming one receipt drops only that one off the queue.
    await db.asUser(f.admin, () => db.sql(
      `select public.admin_confirm_cash_handover($1)`, [handedA.handover_id]))
    const remaining = await db.asUser(f.admin, () => db.sql<{ amount: number }>(
      `select amount from public.admin_pending_cash_handovers()`))
    expect(remaining.map((r) => r.amount)).toEqual([40])
  })
})

describe('the stamp the hand-over leaves is one-way, and only through the RPC', () => {
  test('a rep still cannot write cash_handover_id directly — the grant refuses it', async () => {
    const bookingId = await pickedUpAndPaid(f.repA, f.car1, f.hotelA, { amount: 90, method: 'cash' })
    const receipt = await db.asUser(f.repA, () => db.one<{ id: string }>(
      `insert into public.cash_handovers (rep_id, amount) values ($1, 1) returning id`,
      [f.repA]))

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `update public.bookings set cash_handover_id = $2 where id = $1`, [bookingId, receipt.id]))))
      .toBe('42501')

    expect(await cashOf(f.repA)).toBe(90)   // the figure did not move
  })

  test('the guard reverts a clear or a re-point even when the column grant is bypassed', async () => {
    const bookingId = await pickedUpAndPaid(f.repA, f.car1, f.hotelA, { amount: 90, method: 'cash' })
    await db.asUser(f.repA, () => db.sql(`select public.my_hand_over_cash()`))

    const stamped = await db.one<{ cash_handover_id: string }>(
      `select cash_handover_id from public.bookings where id = $1`, [bookingId])

    // Run as the fixture superuser, which the column grant does not constrain —
    // the closest thing to a SECURITY DEFINER caller that is not
    // my_hand_over_cash(). app.bookings_before_write() still sees a non-admin
    // actor, so the carve-out does not apply and both writes are reverted:
    // the stamp is one-way, and it only ever points at the actor's own receipt.
    await db.sql(`update public.bookings set cash_handover_id = null where id = $1`, [bookingId])
    const cleared = await db.one<{ cash_handover_id: string | null }>(
      `select cash_handover_id from public.bookings where id = $1`, [bookingId])
    expect(cleared.cash_handover_id).toBe(stamped.cash_handover_id)

    const other = await db.asUser(f.repB, () => db.one<{ id: string }>(
      `insert into public.cash_handovers (rep_id, amount) values ($1, 1) returning id`,
      [f.repB]))
    await db.sql(
      `update public.bookings set cash_handover_id = $2 where id = $1`, [bookingId, other.id])
    const repointed = await db.one<{ cash_handover_id: string }>(
      `select cash_handover_id from public.bookings where id = $1`, [bookingId])
    expect(repointed.cash_handover_id).toBe(stamped.cash_handover_id)

    // The stamp survived every bypass attempt, so there is still nothing for
    // a second tap to grab — even though the boss has not confirmed it yet,
    // which is why the whole figure, not just the ready slice, is still 90.
    expect(await readyOf(f.repA)).toBe(0)
    expect(await cashOf(f.repA)).toBe(90)
  })
})
