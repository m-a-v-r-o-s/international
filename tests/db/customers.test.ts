import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, bookAsRep, type Fixtures } from '../helpers/fixtures'

// The Ψηφιακό πελατολόγιο — the customer ledger
// (docs/01-DECISIONS.md §25a, supabase/migrations/20260831120000_customers.sql).
//
// This is the first cross-booking store of guest personal data in the system,
// and the first deliberate hole in §8's cross-rep rule: a rep may now match a
// guest served by a rep they have never met, at a hotel they do not cover. The
// owner chose that, knowingly, and the whole defence is that the door is
// narrow — exact full-number match, one row, no phone number back, rate
// limited, logged, and no SELECT on the table for anyone but the admin.
//
// So this file is written the way tests/db/storage-isolation.test.ts is: mostly
// about what must NOT be reachable. The widening is asserted too
// ("a rep matches a guest from a booking they cannot read"), because it is a
// decision and not an accident — if someone narrows it later, that test failing
// is the conversation, not a silent behaviour change.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.sql(`delete from public.customers`)
  await db.sql(`delete from public.bookings`)
  await db.sql(`delete from app.rate_limits`)
  await db.sql(`delete from app.auth_events`)
  await db.sql(`delete from public.audit_log`)
})

/** A rental with a driver on it, ready to be consented into the ledger. */
async function rentalWithDriver(
  rep: string,
  opts: { hotelId: string; phone?: string; licence?: string; images?: boolean } = {
    hotelId: '',
  },
): Promise<string> {
  const bookingId = await bookAsRep(db, rep, {
    carId: f.car1, hotelId: opts.hotelId || null, start: '2026-07-06', end: '2026-07-08',
    phone: opts.phone ?? '+306941230001', first: 'Anna', last: 'Visitor', dob: '1990-01-01',
  })
  await db.asUser(rep, () => db.sql(
    `insert into public.booking_drivers
       (booking_id, is_main, first_name, last_name, dob,
        licence_number, licence_country, licence_issued_on, licence_expires_on,
        front_image_path, back_image_path)
     values ($1, true, 'Anna', 'Visitor', '1990-01-01', $2, 'GBR', '2015-01-01', '2035-01-01',
             $3, $4)`,
    [
      bookingId, opts.licence ?? 'LIC-12345',
      opts.images === false ? null : `${bookingId}/licences/main-front.jpg`,
      opts.images === false ? null : `${bookingId}/licences/main-back.jpg`,
    ]))
  return bookingId
}

/** Consent, as the rep at the desk gives it: the tick box beside the signature. */
async function consent(rep: string, bookingId: string): Promise<string | null> {
  const row = await db.asUser(rep, () => db.one<{ record_customer_consent: string | null }>(
    `select public.record_customer_consent($1)`, [bookingId]))
  return row.record_customer_consent
}

async function lookup(rep: string, phone: string) {
  return db.asUser(rep, () => db.sql(`select * from public.customer_by_phone($1)`, [phone]))
}

/** The single row a hit must produce — asserting the "at most one" as it goes. */
async function matched<T = Record<string, unknown>>(rep: string, phone: string): Promise<T> {
  const rows = await lookup(rep, phone)
  expect(rows).toHaveLength(1)
  return rows[0] as T
}

/** The one customer these tests put in the ledger. */
async function onlyCustomerId(): Promise<string> {
  const row = await db.one<{ id: string }>(`select id from public.customers`)
  return row.id
}

// ─────────────────────────────────────────────────────────────────────────────
describe('phone normalisation (app.phone_e164)', () => {
  // The match key. Everything downstream is only as good as this, because two
  // spellings of one number are two customers and one wrong guess is somebody
  // else's licence on a rental agreement.
  const cases: [string, string | null][] = [
    ['+306941234567', '+306941234567'],
    ['+30 694 123 4567', '+306941234567'],
    ['+30-694-123-4567', '+306941234567'],
    ['00306941234567', '+306941234567'],
    ['0030 694 123 4567', '+306941234567'],
    ['6941234567', '+306941234567'],       // Greek mobile, no country code
    ['694 123 4567', '+306941234567'],
    ['2831012345', '+302831012345'],       // Greek landline
    ['306941234567', '+306941234567'],     // international, '+' left off
    ['447911123456', '+447911123456'],
    ['+44 7911 123456', '+447911123456'],
    // Ambiguous without a country code: a trunk-zero UK mobile is ten digits
    // that are not Greek-shaped. Guessing +30 here would MATCH THE WRONG
    // PERSON, so it refuses.
    ['07911123456', null],
    ['1234', null],
    ['', null],
    ['not a phone', null],
    ['+0123456789', null],                 // E.164 country codes never start 0
  ]

  test.each(cases)('%s → %s', async (input, expected) => {
    const row = await db.one<{ phone_e164: string | null }>(
      `select app.phone_e164($1) as phone_e164`, [input])
    expect(row.phone_e164).toBe(expected)
  })

  test('two spellings of one number are one customer', async () => {
    const a = await rentalWithDriver(f.repA, { hotelId: f.hotelA, phone: '+30 694 123 4567' })
    await consent(f.repA, a)

    const found = await lookup(f.repA, '6941234567')
    expect(found).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the generated key on the booking', () => {
  test('is computed, not supplied', async () => {
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
      phone: '694 123 4567',
    })
    const row = await db.one<{ cust_phone: string; cust_phone_e164: string }>(
      `select cust_phone, cust_phone_e164 from public.bookings where id = $1`, [id])

    expect(row.cust_phone).toBe('694 123 4567')      // what the rep typed, untouched
    expect(row.cust_phone_e164).toBe('+306941234567')
  })

  test('cannot be written by anybody, including the owner', async () => {
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
    })
    // 428C9 — "column can only be updated to DEFAULT". There is no grant to
    // get wrong here and no trigger ordering to reason about: Postgres
    // refuses the statement outright, for the owner as much as for a rep.
    expect(await errcode(() => db.sql(
      `update public.bookings set cust_phone_e164 = '+306900000000' where id = $1`, [id])))
      .toBe('428C9')
  })

  test('follows the typed number when it is corrected', async () => {
    const id = await bookAsRep(db, f.repA, {
      carId: f.car1, hotelId: f.hotelA, start: '2026-07-06', end: '2026-07-08',
      phone: '6941230001',
    })
    await db.asUser(f.repA, () => db.sql(
      `update public.bookings set cust_phone = '+44 7911 123456' where id = $1`, [id]))

    const row = await db.one<{ cust_phone_e164: string }>(
      `select cust_phone_e164 from public.bookings where id = $1`, [id])
    expect(row.cust_phone_e164).toBe('+447911123456')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('consent is the only door in', () => {
  test('a booking alone ledgers nobody', async () => {
    await rentalWithDriver(f.repA, { hotelId: f.hotelA })

    const all = await db.sql(`select id from public.customers`)
    expect(all).toHaveLength(0)
    expect(await lookup(f.repA, '+306941230001')).toHaveLength(0)
  })

  test('the tick box ledgers them, with the licence details', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    expect(await consent(f.repA, id)).not.toBeNull()

    const row = await matched<{
      first_name: string; licence_number: string; licence_country: string
      has_licence_images: boolean
    }>(f.repA, '+306941230001')
    expect(row.first_name).toBe('Anna')
    expect(row.licence_number).toBe('LIC-12345')
    expect(row.licence_country).toBe('GBR')
    expect(row.has_licence_images).toBe(true)
  })

  test('withdrawing really deletes, not just unlinks', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    await db.asUser(f.repA, () => db.sql(
      `select public.withdraw_customer_consent($1)`, [id]))

    // The orphan trigger: a customer with no consenting booking has no basis
    // to exist, so the row is gone rather than merely unreachable.
    expect(await db.sql(`select id from public.customers`)).toHaveLength(0)
    expect(await lookup(f.repA, '+306941230001')).toHaveLength(0)
  })

  test('deleting the booking takes the ledger row with it', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    await db.sql(`delete from public.bookings where id = $1`, [id])
    expect(await db.sql(`select id from public.customers`)).toHaveLength(0)
  })

  test('a second rental refreshes the same customer, never a duplicate', async () => {
    const first = await rentalWithDriver(f.repA, { hotelId: f.hotelA, licence: 'OLD-1' })
    await consent(f.repA, first)

    // Inside the seeded Peak period: back-dating or forward-dating past the
    // price table raises IR100, the engine correctly refusing to guess.
    const second = await bookAsRep(db, f.repA, {
      carId: f.car2, hotelId: f.hotelA, start: '2026-08-10', end: '2026-08-12',
      phone: '694 123 0001', first: 'Anna', last: 'Visitor-Married', dob: '1990-01-01',
    })
    await db.asUser(f.repA, () => db.sql(
      `insert into public.booking_drivers
         (booking_id, is_main, first_name, last_name, dob,
          licence_number, licence_country, licence_issued_on, licence_expires_on)
       values ($1, true, 'Anna', 'Visitor-Married', '1990-01-01',
               'NEW-2', 'GBR', '2025-01-01', '2045-01-01')`, [second]))
    await consent(f.repA, second)

    expect(await db.sql(`select id from public.customers`)).toHaveLength(1)

    const row = await matched<{ last_name: string; licence_number: string }>(
      f.repA, '+306941230001')
    // The most recent rental is the most current truth about a person.
    expect(row.last_name).toBe('Visitor-Married')
    expect(row.licence_number).toBe('NEW-2')
  })

  test('a licence correction after signing follows through to the ledger', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    await db.asUser(f.repA, () => db.sql(
      `update public.booking_drivers set licence_number = 'CORRECTED-9' where booking_id = $1`,
      [id]))

    const row = await matched<{ licence_number: string }>(f.repA, '+306941230001')
    expect(row.licence_number).toBe('CORRECTED-9')
  })

  test('an unnormalisable number consents to nothing', async () => {
    // Not an error — the rental proceeds. There is simply nothing to key on.
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA, phone: '07911123456' })
    expect(await consent(f.repA, id)).toBeNull()
    expect(await db.sql(`select id from public.customers`)).toHaveLength(0)
  })

  test('a rep cannot consent a booking they may not read', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    // Rep B is at Hotel Beta and did not create it: not theirs to ledger.
    expect(await errcode(() => db.asUser(f.repB, () => db.sql(
      `select public.record_customer_consent($1)`, [id])))).toBe('IR001')
  })

  test('a rep cannot withdraw consent on a booking they may not read', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    expect(await errcode(() => db.asUser(f.repB, () => db.sql(
      `select public.withdraw_customer_consent($1)`, [id])))).toBe('IR001')
    expect(await db.sql(`select id from public.customers`)).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the table itself is not readable', () => {
  test('a rep selecting from public.customers gets nothing, ever', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    // Not "cannot see other people's" — cannot see ANY, including the row
    // their own booking created. The lookup function is the only door.
    const seen = await db.asUser(f.repA, () => db.sql(`select id from public.customers`))
    expect(seen).toHaveLength(0)
  })

  test('a signed-out caller reaches neither the table nor the function', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    // Refused by the GRANT, before RLS is even consulted — `anon` holds no
    // privilege on this table at all, which is a stronger no than an empty
    // result. Same for the function: it is granted to `authenticated` and
    // `service_role` only.
    expect(await errcode(() => db.as({ kind: 'anon' }, () => db.sql(
      `select id from public.customers`)))).toBe('42501')
    expect(await errcode(() => db.as({ kind: 'anon' }, () => db.sql(
      `select * from public.customer_by_phone($1)`, ['+306941230001'])))).toBe('42501')
  })

  test('a deactivated account is not staff and matches nothing', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    expect(await errcode(() => db.asUser(f.inactive, () => db.sql(
      `select * from public.customer_by_phone($1)`, ['+306941230001'])))).toBe('IR001')
  })

  test('the admin can read the table — they could already see every booking', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    const seen = await db.asUser(f.admin, () => db.sql(`select id from public.customers`))
    expect(seen).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the lookup function is a narrow door', () => {
  test('THE WIDENING: a rep matches a guest from a booking they cannot read', async () => {
    // docs/01-DECISIONS.md §25a decision 3, asserted deliberately. Rep B is at
    // Hotel Beta, did not create this booking and cannot open it — and still
    // gets the match, because the owner chose a company-wide lookup. If this
    // test ever fails, the decision changed; that is a conversation, not a bug
    // to quietly fix in either direction.
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    const canReadBooking = await db.asUser(f.repB, () => db.sql(
      `select id from public.bookings where id = $1`, [id]))
    expect(canReadBooking).toHaveLength(0)

    expect(await lookup(f.repB, '+306941230001')).toHaveLength(1)
  })

  test('never hands back the phone number it was given', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    const row = await matched(f.repA, '+306941230001')
    // A miss returns nothing and a hit returns no number, so the function
    // cannot be used to confirm what it was not already told.
    expect(Object.keys(row)).not.toContain('phone_e164')
    expect(JSON.stringify(row)).not.toContain('306941230001')
  })

  test('exact numbers only — no prefix, no partial, no wildcard', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    for (const attempt of ['+3069412300', '69412300', '%', '+3069412300019', '_______']) {
      expect(await lookup(f.repA, attempt)).toHaveLength(0)
    }
  })

  test('leaks nothing about a booking — no hotel, room, price or rep', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    const row = await matched(f.repB, '+306941230001')
    const keys = Object.keys(row)
    for (const forbidden of [
      'hotel_id', 'room_number', 'total', 'created_by', 'booking_id', 'ref',
    ]) {
      expect(keys).not.toContain(forbidden)
    }
  })

  test('every call is logged, hit or miss, without the number tried', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    await lookup(f.repB, '+306941230001')   // hit
    await lookup(f.repB, '+306999999999')   // miss

    const events = await db.sql<{ profile_id: string; detail: { found: boolean } }>(
      `select profile_id, detail from app.auth_events
        where kind = 'customer_lookup' order by id`)
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.detail.found)).toEqual([true, false])
    expect(events.every((e) => e.profile_id === f.repB)).toBe(true)
    expect(JSON.stringify(events)).not.toContain('306941230001')
  })

  test('is rate limited in the database, not in the app', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    // Exhaust the rep's hourly bucket directly rather than calling 120 times.
    // The bucket name and the fixed hour window are the ones
    // app.rate_limit_hit() computes.
    await db.sql(
      `insert into app.rate_limits (bucket, window_start, hits)
       values ($1, to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 999)`,
      [`custlookup:${f.repB}`])

    expect(await errcode(() => lookup(f.repB, '+306941230001'))).toBe('IR122')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('licence images', () => {
  test('the paths are not in the lookup result — they are asked for separately', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    const row = await matched(f.repA, '+306941230001')
    expect(JSON.stringify(row)).not.toContain('/licences/')
  })

  test('a purge clears the pointers, so nothing tries to copy a deleted file', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    await db.sql(
      `update public.booking_drivers set images_purged_at = now() where booking_id = $1`, [id])

    const row = await matched<{ has_licence_images: boolean }>(f.repA, '+306941230001')
    expect(row.has_licence_images).toBe(false)

    const images = await db.asUser(f.repA, () => db.sql(
      `select * from public.customer_licence_images(
         (select id from public.customers limit 1))`))
    expect(images).toHaveLength(0)
  })

  test('a customer with no stored photos names no paths', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA, images: false })
    await consent(f.repA, id)

    const images = await db.asUser(f.repA, () => db.sql(
      `select * from public.customer_licence_images(
         (select id from public.customers limit 1))`))
    expect(images).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('erasure and clearing — the only retention this table has', () => {
  test('a rep cannot erase a customer', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)
    const customerId = await onlyCustomerId()

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select * from public.admin_erase_customer($1)`, [customerId])))).toBe('IR001')
    expect(await db.sql(`select id from public.customers`)).toHaveLength(1)
  })

  test('the admin erases one guest, and is told which photos to delete', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)
    const customerId = await onlyCustomerId()

    const returned = await db.asUser(f.admin, () => db.sql<{ front_path: string }>(
      `select * from public.admin_erase_customer($1)`, [customerId]))

    // The paths come BACK rather than the row being deleted quietly, because
    // the objects are removed through the Storage API — deleting the metadata
    // row here would leave the photograph in the bucket (§25's lesson).
    expect(returned).toHaveLength(1)
    expect(returned[0]?.front_path).toContain('/licences/')
    expect(await db.sql(`select id from public.customers`)).toHaveLength(0)
    // The booking is NOT deleted: it is an accounting record (§25).
    expect(await db.sql(`select id from public.bookings where id = $1`, [id])).toHaveLength(1)
  })

  test('a rep cannot clear the ledger', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select public.admin_clear_customer_ledger('ERASE-ALL', true, true)`)))).toBe('IR001')
    expect(await db.sql(`select id from public.customers`)).toHaveLength(1)
  })

  test('all three confirmations are re-checked in the database', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    // A form is not a check. Each of these is a POST that skipped one box.
    const attempts: [string, boolean, boolean][] = [
      ['', true, true],
      ['erase-all', true, true],
      ['DELETE', true, true],
      ['ERASE-ALL', false, true],
      ['ERASE-ALL', true, false],
      ['ERASE-ALL', false, false],
    ]
    for (const [phrase, understood, irreversible] of attempts) {
      expect(await errcode(() => db.asUser(f.admin, () => db.sql(
        `select public.admin_clear_customer_ledger($1, $2, $3)`,
        [phrase, understood, irreversible])))).toBe('IR104')
    }
    expect(await db.sql(`select id from public.customers`)).toHaveLength(1)
  })

  test('with all three, it empties the ledger and says how many went', async () => {
    for (const [i, phone] of ['+306941230001', '+306941230002'].entries()) {
      const id = await bookAsRep(db, f.repA, {
        carId: i === 0 ? f.car1 : f.car2, hotelId: f.hotelA,
        start: '2026-07-06', end: '2026-07-08', phone,
      })
      await db.asUser(f.repA, () => db.sql(
        `insert into public.booking_drivers
           (booking_id, is_main, first_name, last_name, dob)
         values ($1, true, 'Anna', 'Visitor', '1990-01-01')`, [id]))
      await consent(f.repA, id)
    }

    const row = await db.asUser(f.admin, () => db.one<{ admin_clear_customer_ledger: number }>(
      `select public.admin_clear_customer_ledger('ERASE-ALL', true, true)`))

    expect(row.admin_clear_customer_ledger).toBe(2)
    expect(await db.sql(`select id from public.customers`)).toHaveLength(0)
    // The bookings survive it. Only the cross-booking identity goes.
    expect(await db.sql(`select id from public.bookings`)).toHaveLength(2)
  })

  test('clearing is logged with a count and no personal data', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    await db.asUser(f.admin, () => db.sql(
      `select public.admin_clear_customer_ledger('ERASE-ALL', true, true)`))

    const event = await db.one<{ detail: { customers: number } }>(
      `select detail from app.auth_events where kind = 'customer_ledger_cleared'`)
    expect(event.detail.customers).toBe(1)
    expect(JSON.stringify(event)).not.toContain('Anna')
  })

  test('a rep cannot read the ledger status', async () => {
    expect(await errcode(() => db.asUser(f.repA, () => db.sql(
      `select * from public.admin_customer_ledger_status()`)))).toBe('IR001')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('erasure is not undone by the audit log', () => {
  test('erasing a customer leaves no name or date of birth behind', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)
    const customerId = await onlyCustomerId()

    await db.asUser(f.admin, () => db.sql(
      `select * from public.admin_erase_customer($1)`, [customerId]))

    // public.customers is deliberately NOT audited (docs/01-DECISIONS.md §25a).
    // app.audit_redact() strips licence numbers and image paths but not names
    // or dates of birth, so an audit trigger here would write the guest's
    // details into a table with no erasure path, in the same statement that
    // claimed to erase them.
    const rows = await db.sql(
      `select id from public.audit_log where entity = 'customers'`)
    expect(rows).toHaveLength(0)

    // Belt and braces: the ledger's own values are nowhere in the audit log at
    // all. (The BOOKING legitimately still holds the guest's name — it is an
    // accounting record and §25 says so — so this looks only at what the
    // ledger itself would have written.)
    const ledgerAudit = await db.sql(
      `select id from public.audit_log where entity in ('customers', 'customer_bookings')
         and (before::text ilike '%LIC-12345%' or after::text ilike '%LIC-12345%')`)
    expect(ledgerAudit).toHaveLength(0)
  })

  test('the consent link IS audited — it holds no personal data', async () => {
    const id = await rentalWithDriver(f.repA, { hotelId: f.hotelA })
    await consent(f.repA, id)

    const rows = await db.sql(
      `select id from public.audit_log where entity = 'customer_bookings'`)
    expect(rows.length).toBeGreaterThan(0)
  })
})
