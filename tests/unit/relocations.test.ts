import { describe, expect, test } from 'vitest'
import {
  buildRelocationRows,
  type RelocationBooking, type RelocationCar, type RelocationDecision,
} from '@/lib/relocations/data'
import { addDays } from '@/lib/dates'

// A13 · the derivation behind the overnight shuffle (docs/01-DECISIONS.md §45).
//
// This is the whole business rule, and it is pure: given tonight's returns,
// tomorrow's pick-ups, the boss's overrides and where each car is based, which
// cars appear and where does each one have to go. The database guarantees are
// in tests/db/admin-relocations.test.ts; this is the question the SQL cannot
// answer, which is what the sheet should SAY.

const ALPHA = 'hotel-alpha'
const BETA = 'hotel-beta'
const YARD = 'hotel-yard'

const hotelById = new Map([[ALPHA, 'Hotel Alpha'], [BETA, 'Hotel Beta'], [YARD, 'Γραφείο']])
const modelById = new Map([['m1', 'Fiat Panda']])

function car(id: string, plate: string, stationed_at: string | null = null): RelocationCar {
  return { id, plate, model_id: 'm1', stationed_at }
}

function booking(
  carId: string, hotel: string | null, extra: Partial<RelocationBooking> = {},
): RelocationBooking {
  return {
    car_id: carId,
    hotel_id: hotel,
    adhoc_hotel_name: null,
    pickup_at: null,
    dropoff_at: null,
    cust_first: 'Anna',
    cust_last: 'Visitor',
    ...extra,
  }
}

function build(input: {
  returns?: RelocationBooking[]
  pickups?: RelocationBooking[]
  decisions?: RelocationDecision[]
  cars: RelocationCar[]
}) {
  return buildRelocationRows({
    returns: input.returns ?? [],
    pickups: input.pickups ?? [],
    decisions: input.decisions ?? [],
    cars: input.cars,
    hotelById,
    modelById,
  })
}

describe('the case the screen exists for', () => {
  test('back at Alpha tonight, wanted at Beta in the morning → Alpha → Beta', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001')],
      returns: [booking('c1', ALPHA)],
      pickups: [booking('c1', BETA)],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.from.label).toBe('Hotel Alpha')
    expect(rows[0]?.to.label).toBe('Hotel Beta')
    expect(rows[0]?.reason).toBe('return')
  })

  test('back and wanted at the SAME hotel is listed, but as a stay', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001')],
      returns: [booking('c1', ALPHA)],
      pickups: [booking('c1', ALPHA)],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.to.label).toBeNull()
  })
})

describe('a car that is merely returned', () => {
  test('is listed with nowhere to go, so a destination can be invented for it', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001')],
      returns: [booking('c1', ALPHA)],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.to.label).toBeNull()
    expect(rows[0]?.reason).toBe('return')
  })

  test('and once the boss sends it somewhere, it becomes a move he owns', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001')],
      returns: [booking('c1', ALPHA)],
      decisions: [{ car_id: 'c1', to_hotel_id: YARD, done_at: null }],
    })

    expect(rows[0]?.to.label).toBe('Γραφείο')
    expect(rows[0]?.overridden).toBe(true)
  })
})

describe('the idle car nothing else would catch', () => {
  test('based at Alpha, booked at Beta tomorrow, nothing happening today — still listed', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001', ALPHA)],
      pickups: [booking('c1', BETA)],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.reason).toBe('idle')
    expect(rows[0]?.from.label).toBe('Hotel Alpha')
    expect(rows[0]?.to.label).toBe('Hotel Beta')
  })

  test('based where it is already wanted — not news, not listed', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001', BETA)],
      pickups: [booking('c1', BETA)],
    })

    expect(rows).toEqual([])
  })

  test('an unplaced car wanted tomorrow is listed, because nobody knows where it is', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001', null)],
      pickups: [booking('c1', BETA)],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.from.label).toBeNull()
    expect(rows[0]?.to.label).toBe('Hotel Beta')
  })

  test('a car with nothing tonight and nothing tomorrow never appears', () => {
    expect(build({ cars: [car('c1', 'ABC-1001', ALPHA)] })).toEqual([])
  })
})

describe('what the boss decides wins over what the bookings imply', () => {
  test('his destination replaces the derived one', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001')],
      returns: [booking('c1', ALPHA)],
      pickups: [booking('c1', BETA)],
      decisions: [{ car_id: 'c1', to_hotel_id: YARD, done_at: null }],
    })

    expect(rows[0]?.to.label).toBe('Γραφείο')
  })

  test('a null destination on an existing row means "stays", against a derived move', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001')],
      returns: [booking('c1', ALPHA)],
      pickups: [booking('c1', BETA)],
      decisions: [{ car_id: 'c1', to_hotel_id: null, done_at: null }],
    })

    expect(rows[0]?.to.label).toBeNull()
    expect(rows[0]?.overridden).toBe(true)
  })

  test('a car with only a decision behind it is listed as such', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001', ALPHA)],
      decisions: [{ car_id: 'c1', to_hotel_id: BETA, done_at: null }],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.reason).toBe('manual')
    expect(rows[0]?.from.label).toBe('Hotel Alpha')
  })

  test('a done move carries its timestamp through', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001')],
      returns: [booking('c1', ALPHA)],
      decisions: [{ car_id: 'c1', to_hotel_id: BETA, done_at: '2026-06-12T20:30:00Z' }],
    })

    expect(rows[0]?.doneAt).toBe('2026-06-12T20:30:00Z')
  })
})

describe('hotels that are not in the system (§42)', () => {
  test('a return to an ad-hoc hotel names it as the starting point', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001')],
      returns: [booking('c1', null, { adhoc_hotel_name: 'Villa Rosa' })],
      pickups: [booking('c1', BETA)],
    })

    expect(rows[0]?.from.label).toBe('Villa Rosa')
    expect(rows[0]?.from.adhoc).toBe(true)
    expect(rows[0]?.to.label).toBe('Hotel Beta')
  })

  test('an ad-hoc destination is flagged, so the screen can refuse to tick it off', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001')],
      returns: [booking('c1', ALPHA)],
      pickups: [booking('c1', null, { adhoc_hotel_name: 'Villa Rosa' })],
    })

    expect(rows[0]?.to.label).toBe('Villa Rosa')
    expect(rows[0]?.to.adhoc).toBe(true)
    expect(rows[0]?.to.hotelId).toBeNull()
  })

  test('back at an ad-hoc hotel and wanted at the same one is a stay, spelling notwithstanding', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001')],
      returns: [booking('c1', null, { adhoc_hotel_name: 'Villa Rosa' })],
      pickups: [booking('c1', null, { adhoc_hotel_name: 'villa rosa ' })],
    })

    expect(rows[0]?.to.label).toBeNull()
  })
})

describe('archived and missing cars', () => {
  test('a booking whose car is not in the fleet list is dropped, not crashed on', () => {
    expect(build({ cars: [], returns: [booking('gone', ALPHA)] })).toEqual([])
  })
})

describe('the order the night is worked in', () => {
  test('moves lead, then stays; each grouped by where the driving starts', () => {
    const rows = build({
      cars: [
        car('c1', 'ABC-1001'), car('c2', 'ABC-1002'),
        car('c3', 'ABC-1003'), car('c4', 'ABC-1004'),
      ],
      returns: [
        booking('c1', BETA), booking('c2', ALPHA),
        booking('c3', ALPHA), booking('c4', ALPHA),
      ],
      // c1 and c3 have to move; c2 and c4 have nowhere to go.
      pickups: [booking('c1', ALPHA), booking('c3', BETA)],
    })

    expect(rows.map((r) => r.plate)).toEqual([
      'ABC-1003',  // move, from Alpha
      'ABC-1001',  // move, from Beta
      'ABC-1002',  // stay, from Alpha — plate order within the group
      'ABC-1004',
    ])
  })

  test('an unplaced car sorts last within its group rather than first', () => {
    const rows = build({
      cars: [car('c1', 'ABC-1001', null), car('c2', 'ABC-1002', ALPHA)],
      pickups: [booking('c1', BETA), booking('c2', BETA)],
    })

    expect(rows.map((r) => r.plate)).toEqual(['ABC-1002', 'ABC-1001'])
  })
})

describe('the morning a night serves', () => {
  test('addDays crosses a month, a year and a DST changeover without drifting', () => {
    expect(addDays('2026-06-12', 1)).toBe('2026-06-13')
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    // Greece springs forward on 2026-03-29 and back on 2026-10-25.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })
})
