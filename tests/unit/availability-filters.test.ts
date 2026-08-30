import { describe, expect, test } from 'vitest'
import { isFreeForRange, swapCandidates, currentCarFreeThrough } from '../../src/lib/availability/types'

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
