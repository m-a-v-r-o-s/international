import { describe, expect, test } from 'vitest'
import { groupSeatExtras, parseQuickBooking, quickBookingSchema } from '../../src/lib/bookings/quick'

// R3b · the booking confirmation taken over the phone (docs/01-DECISIONS.md
// §30 decision 2). The schema is the whole of what this screen refuses, so it
// is tested directly rather than through the action wrapped around it.

const CAR = '11111111-1111-4111-8111-111111111111'
const HOTEL = '22222222-2222-4222-9222-222222222222'

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) fd.append(key, one)
  }
  return fd
}

function valid(overrides: Record<string, string | string[]> = {}) {
  return form({
    car_id: CAR,
    hotel_id: HOTEL,
    start_date: '2026-07-06',
    end_date: '2026-07-08',
    cust_phone: '+306900000001',
    ...overrides,
  })
}

describe('what a phone booking must have', () => {
  test('a car, a hotel, dates and a number are enough', () => {
    const parsed = parseQuickBooking(valid())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.cust_phone).toBe('+306900000001')
    // The three fields R3 requires and this one does not.
    expect(parsed.data.cust_first).toBeNull()
    expect(parsed.data.cust_last).toBeNull()
    expect(parsed.data).not.toHaveProperty('cust_dob')
  })

  test('the phone number is the one thing it will not do without', () => {
    expect(parseQuickBooking(valid({ cust_phone: '' })).ok).toBe(false)
    expect(parseQuickBooking(valid({ cust_phone: '  ' })).ok).toBe(false)
    // Too short to be any real number, and the ledger key (§25a) is a number.
    expect(parseQuickBooking(valid({ cust_phone: '12' })).ok).toBe(false)
    expect(parseQuickBooking(valid({ cust_phone: '9'.repeat(33) })).ok).toBe(false)
  })

  test('a missing car or hotel is refused, not defaulted', () => {
    expect(parseQuickBooking(valid({ car_id: '' })).ok).toBe(false)
    expect(parseQuickBooking(valid({ hotel_id: '' })).ok).toBe(false)
    expect(parseQuickBooking(valid({ car_id: 'not-a-uuid' })).ok).toBe(false)
  })

  test('the dates must be real and the right way round', () => {
    expect(parseQuickBooking(valid({ start_date: '06/07/2026' })).ok).toBe(false)
    expect(parseQuickBooking(valid({ end_date: '2026-07-05' })).ok).toBe(false)
    // One day, by §4's inclusive count — the walk-in's default.
    expect(parseQuickBooking(valid({ start_date: '2026-07-06', end_date: '2026-07-06' })).ok).toBe(true)
  })
})

describe('the name, which the owner did not ask for and which is never required', () => {
  test('is kept when it is given', () => {
    const parsed = parseQuickBooking(valid({ cust_first: ' Anna ', cust_last: 'Guest' }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.cust_first).toBe('Anna')
    expect(parsed.data.cust_last).toBe('Guest')
  })

  test('an empty field is null, never an empty string on the contract', () => {
    const parsed = parseQuickBooking(valid({ cust_first: '   ', cust_last: '' }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.cust_first).toBeNull()
    expect(parsed.data.cust_last).toBeNull()
  })

  test('a name longer than the column is refused rather than silently cut', () => {
    expect(parseQuickBooking(valid({ cust_first: 'A'.repeat(81) })).ok).toBe(false)
  })
})

describe('the rest of the narrow form', () => {
  test('the room is optional and capped at the column width', () => {
    expect(parseQuickBooking(valid({ room_number: '' })).ok).toBe(true)
    expect(parseQuickBooking(valid({ room_number: '304' })).ok).toBe(true)
    expect(parseQuickBooking(valid({ room_number: 'x'.repeat(17) })).ok).toBe(false)
  })

  test('seats are the three the database enumerates, and nothing else', () => {
    const parsed = parseQuickBooking(valid({ seat: ['infant', 'booster'] }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.seats).toEqual(['infant', 'booster'])

    expect(parseQuickBooking(valid({ seat: ['limousine'] })).ok).toBe(false)
    // None at all is the common case, not an error.
    expect(parseQuickBooking(valid()).ok).toBe(true)
  })

  test('times are optional but must be a real 24-hour clock time', () => {
    expect(parseQuickBooking(valid({ pickup_time: '' })).ok).toBe(true)
    expect(parseQuickBooking(valid({ pickup_time: '08:30' })).ok).toBe(true)
    expect(parseQuickBooking(valid({ pickup_time: '24:00' })).ok).toBe(false)
    expect(parseQuickBooking(valid({ dropoff_time: '9pm' })).ok).toBe(false)
  })
})

describe('how many of each seat the car gets', () => {
  test('a repeated value becomes one row with the count', () => {
    expect(groupSeatExtras(['child', 'child', 'child'])).toEqual([{ seat: 'child', qty: 3 }])
  })

  test('different types stay as separate rows', () => {
    expect(groupSeatExtras(['infant', 'child', 'infant'])).toEqual([
      { seat: 'infant', qty: 2 },
      { seat: 'child', qty: 1 },
    ])
  })

  test('a tampered request cannot exceed three of one type', () => {
    expect(groupSeatExtras(['booster', 'booster', 'booster', 'booster', 'booster']))
      .toEqual([{ seat: 'booster', qty: 3 }])
  })

  test('none at all is an empty list, not a zero-qty row', () => {
    expect(groupSeatExtras([])).toEqual([])
  })
})

describe('where the rep is sent afterwards', () => {
  test('defaults to the booking slip', () => {
    const parsed = parseQuickBooking(valid())
    expect(parsed.ok && parsed.data.next).toBe('detail')
  })

  test('the walk-in path asks for the pickup flow', () => {
    const parsed = parseQuickBooking(valid({ next: 'pickup' }))
    expect(parsed.ok && parsed.data.next).toBe('pickup')
  })

  test('anything else is refused — this value decides a redirect', () => {
    // The two allowed values look harmless, which is exactly why the field is
    // validated rather than interpolated: it is a redirect target read off a
    // request body.
    expect(parseQuickBooking(valid({ next: 'https://example.com' })).ok).toBe(false)
    expect(parseQuickBooking(valid({ next: '//evil.example' })).ok).toBe(false)
    expect(parseQuickBooking(valid({ next: '/admin/pricing' })).ok).toBe(false)
  })
})

describe('the fields it will not carry at all', () => {
  test('a price, a status or an author sent with the form are dropped', () => {
    // The guard trigger would overwrite them and the column grant would refuse
    // them, but the schema is the first of the three to say no, and it says no
    // by not having them: zod strips what it does not declare.
    const parsed = quickBookingSchema.safeParse({
      car_id: CAR,
      hotel_id: HOTEL,
      start_date: '2026-07-06',
      end_date: '2026-07-08',
      cust_phone: '+306900000001',
      total: 1,
      status: 'out',
      created_by: '33333333-3333-4333-a333-333333333333',
      block_reason: 'mine',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data).not.toHaveProperty('total')
    expect(parsed.data).not.toHaveProperty('status')
    expect(parsed.data).not.toHaveProperty('created_by')
    expect(parsed.data).not.toHaveProperty('block_reason')
  })
})
