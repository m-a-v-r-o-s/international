import { describe, expect, test } from 'vitest'
import {
  isFreeForRange, swapCandidates, currentCarFreeThrough, groupFleet,
} from '../../src/lib/availability/types'
import type { CarWithSpecs } from '../../src/lib/availability/types'

// This is a filter over dates the server already computed via availability()
// — string comparison on YYYY-MM-DD, not a reimplementation of the inclusive-
// day rule or any other business arithmetic (HANDOFF.md: no date arithmetic
// in TypeScript). It exists so R2 can grey out a car without a second RPC
// call per row.

describe('isFreeForRange', () => {
  test('free when no occupied date falls in the range', () => {
    expect(isFreeForRange(['2026-07-01', '2026-07-02'], '2026-07-10', '2026-07-15')).toBe(true)
  })

  test('occupied when any occupied date falls inside the range', () => {
    expect(isFreeForRange(['2026-07-12'], '2026-07-10', '2026-07-15')).toBe(false)
  })

  test('occupied on a boundary date, inclusive both ends', () => {
    expect(isFreeForRange(['2026-07-10'], '2026-07-10', '2026-07-15')).toBe(false)
    expect(isFreeForRange(['2026-07-15'], '2026-07-10', '2026-07-15')).toBe(false)
  })

  test('free when the occupied list is empty', () => {
    expect(isFreeForRange([], '2026-07-10', '2026-07-15')).toBe(true)
  })
})

describe('swap candidates for an extension (R7)', () => {
  const cars = [
    { id: 'current', category_id: 'A' },
    { id: 'sameCatFree', category_id: 'A' },
    { id: 'sameCatBusyDuringRental', category_id: 'A' },
    { id: 'sameCatBusyDuringExtension', category_id: 'A' },
    { id: 'otherCat', category_id: 'B' },
  ]

  // The rental runs 6th–8th and is being extended to the 10th.
  const opts = { currentCarId: 'current', categoryId: 'A', start: '2026-07-06', end: '2026-07-10' }

  test('a car busy inside the ORIGINAL rental dates is not a candidate', () => {
    // The trap: it is free for the days being added, and the swap still fails,
    // because one booking row holds one car and the whole rental moves onto it.
    const occupied = new Map([
      ['sameCatBusyDuringRental', ['2026-07-04', '2026-07-05', '2026-07-06']],
    ])
    const ids = swapCandidates(cars, occupied, opts).map((c) => c.id)

    expect(ids).not.toContain('sameCatBusyDuringRental')
    expect(ids).toContain('sameCatFree')
  })

  test('a car busy inside the extension is not a candidate either', () => {
    const occupied = new Map([['sameCatBusyDuringExtension', ['2026-07-09']]])
    expect(swapCandidates(cars, occupied, opts).map((c) => c.id))
      .not.toContain('sameCatBusyDuringExtension')
  })

  test('a different category is never offered — the guard raises IR111', () => {
    expect(swapCandidates(cars, new Map(), opts).map((c) => c.id)).not.toContain('otherCat')
  })

  test('the car the rental is already on is not offered as a swap', () => {
    expect(swapCandidates(cars, new Map(), opts).map((c) => c.id)).not.toContain('current')
  })

  test('a car busy either side of the whole range is still a candidate', () => {
    const occupied = new Map([['sameCatFree', ['2026-07-05', '2026-07-11']]])
    expect(swapCandidates(cars, occupied, opts).map((c) => c.id)).toContain('sameCatFree')
  })
})

describe('is the current car free through the new date? (R7)', () => {
  test('the booking\'s own dates do not count as a clash', () => {
    // availability() reports the rental's own hold on its own car.
    const own = ['2026-07-06', '2026-07-07', '2026-07-08']
    expect(currentCarFreeThrough(own, '2026-07-08', '2026-07-10')).toBe(true)
  })

  test('someone else\'s hold inside the extension does', () => {
    const dates = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09']
    expect(currentCarFreeThrough(dates, '2026-07-08', '2026-07-10')).toBe(false)
  })

  test('a hold beyond the new return date is not this extension\'s problem', () => {
    expect(currentCarFreeThrough(['2026-07-14'], '2026-07-08', '2026-07-10')).toBe(true)
  })
})

describe('grouping the fleet by model (R2)', () => {
  // Two Pandas and one i10 in group A, one Yaris in group B — small enough to
  // count by eye, and shaped like the real fleet, where every model carries
  // several near-identical plates.
  const car = (
    id: string, modelId: string, categoryId: string, make: string, model: string,
  ): CarWithSpecs => ({
    id,
    plate: id.toUpperCase(),
    photo_path: null,
    model_id: modelId,
    model_photo_path: `${modelId}/aaaaaaaaaaaaaaaa.jpg`,
    make,
    model,
    category_id: categoryId,
    category_code: categoryId,
    transmission: 'manual',
    fuel_type: 'petrol',
    seats: 5,
    doors: 5,
  })

  const fleet = [
    car('panda1', 'm-panda', 'A', 'Fiat', 'Panda'),
    car('panda2', 'm-panda', 'A', 'Fiat', 'Panda'),
    car('i10', 'm-i10', 'A', 'Hyundai', 'i10'),
    car('yaris', 'm-yaris', 'B', 'Toyota', 'Yaris'),
  ]

  const group = (out: ReturnType<typeof groupFleet>, id: string) =>
    out.find((g) => g.categoryId === id)!
  const modelOf = (out: ReturnType<typeof groupFleet>, cat: string, id: string) =>
    group(out, cat).models.find((m) => m.modelId === id)!

  test('one card per model, however many plates sit behind it', () => {
    const out = groupFleet(fleet, new Map(), '2026-07-10', '2026-07-15')
    expect(out).toHaveLength(2)
    expect(group(out, 'A').models.map((m) => m.modelId)).toEqual(['m-panda', 'm-i10'])
    expect(modelOf(out, 'A', 'm-panda').total).toBe(2)
    expect(modelOf(out, 'A', 'm-panda').plates.map((p) => p.plate)).toEqual(['PANDA1', 'PANDA2'])
  })

  test('an empty occupied map means the whole fleet is free', () => {
    const out = groupFleet(fleet, new Map(), '2026-07-10', '2026-07-15')
    expect(group(out, 'A')).toMatchObject({ free: 3, total: 3 })
    expect(modelOf(out, 'A', 'm-panda').free).toBe(2)
  })

  test('a plate occupied for ONE day of the range does not count as free', () => {
    // The trap this guards. A booking holds one car for the whole rental, so a
    // plate free for five days of a six-day search is not an offer the rep can
    // make — counting it would put a number on screen that the confirm step
    // then refuses, in front of the guest.
    const out = groupFleet(fleet, new Map([['panda1', ['2026-07-12']]]), '2026-07-10', '2026-07-15')
    expect(modelOf(out, 'A', 'm-panda')).toMatchObject({ free: 1, total: 2 })
    expect(group(out, 'A')).toMatchObject({ free: 2, total: 3 })
  })

  test('a model with nothing free reports zero and offers no car to book', () => {
    const occupied = new Map([['panda1', ['2026-07-11']], ['panda2', ['2026-07-14']]])
    const out = groupFleet(fleet, occupied, '2026-07-10', '2026-07-15')
    expect(modelOf(out, 'A', 'm-panda')).toMatchObject({ free: 0, firstFreeCarId: null })
    // The greyed-out card still holds its place in the group.
    expect(group(out, 'A').models.map((m) => m.modelId)).toEqual(['m-panda', 'm-i10'])
  })

  test('Book names the FIRST free plate, not merely the first plate', () => {
    const out = groupFleet(fleet, new Map([['panda1', ['2026-07-12']]]), '2026-07-10', '2026-07-15')
    expect(modelOf(out, 'A', 'm-panda').firstFreeCarId).toBe('panda2')
  })

  test('each plate carries its own free flag, so the disclosure can list them', () => {
    const out = groupFleet(fleet, new Map([['panda1', ['2026-07-12']]]), '2026-07-10', '2026-07-15')
    expect(modelOf(out, 'A', 'm-panda').plates).toEqual([
      { id: 'panda1', plate: 'PANDA1', free: false },
      { id: 'panda2', plate: 'PANDA2', free: true },
    ])
  })

  test('an empty fleet is an empty list, not a group with no models', () => {
    expect(groupFleet([], new Map(), '2026-07-10', '2026-07-15')).toEqual([])
  })
})
