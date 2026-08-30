import { describe, expect, test } from 'vitest'
import { isFreeForRange } from '../../src/lib/availability/types'

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
