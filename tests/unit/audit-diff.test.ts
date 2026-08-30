import { describe, expect, test } from 'vitest'
import { changedFields, formatValue, MAX_VALUE_LENGTH, type AuditRow } from '@/lib/audit/diff'

// A9 shows the DIFFERENCE between `before` and `after`, not both rows side by
// side. The rule is pure so it can be tested without a database, the same
// reasoning as src/lib/storage/paths.ts.

const entry = (over: Partial<AuditRow>): AuditRow => ({
  id: 1,
  at: '2026-08-31T09:00:00Z',
  actor_id: null,
  actor_name: null,
  entity: 'bookings',
  entity_id: null,
  action: 'update',
  before: null,
  after: null,
  ...over,
})

describe('what counts as a change', () => {
  test('an update reports only the fields that actually moved', () => {
    const changes = changedFields(entry({
      action: 'update',
      before: { room_number: '101', status: 'booked', cust_first: 'Anna' },
      after: { room_number: '202', status: 'booked', cust_first: 'Anna' },
    }))

    expect(changes).toEqual([{ field: 'room_number', from: '101', to: '202' }])
  })

  test('an insert reports every field, because there is no before', () => {
    const changes = changedFields(entry({
      action: 'insert',
      after: { room_number: '101', status: 'booked' },
    }))

    expect(changes).toEqual([
      { field: 'room_number', from: null, to: '101' },
      { field: 'status', from: null, to: 'booked' },
    ])
  })

  test('a delete reports what was there', () => {
    const changes = changedFields(entry({
      action: 'delete',
      before: { plate: 'ABC-1001' },
    }))

    expect(changes).toEqual([{ field: 'plate', from: 'ABC-1001', to: null }])
  })

  test('a field set to null, and one filled in from null, are both changes', () => {
    const changes = changedFields(entry({
      before: { cust_email: 'a@example.com', cust_phone: null },
      after: { cust_email: null, cust_phone: '+306900000000' },
    }))

    expect(changes).toEqual([
      { field: 'cust_email', from: 'a@example.com', to: null },
      { field: 'cust_phone', from: null, to: '+306900000000' },
    ])
  })

  test('updated_at is not a change anybody made', () => {
    // It moves on every write by definition and says nothing about the actor,
    // so an entry whose only difference is the timestamp shows nothing.
    const changes = changedFields(entry({
      before: { room_number: '101', updated_at: '2026-08-30T09:00:00Z', id: 'x' },
      after: { room_number: '101', updated_at: '2026-08-31T09:00:00Z', id: 'x' },
    }))

    expect(changes).toEqual([])
  })

  test('a field that is null on both sides is not reported', () => {
    const changes = changedFields(entry({
      action: 'insert',
      after: { room_number: '101', cust_email: null },
    }))

    expect(changes).toEqual([{ field: 'room_number', from: null, to: '101' }])
  })

  test('fields come back in a stable order, whatever order the row arrived in', () => {
    const changes = changedFields(entry({
      action: 'insert',
      after: { zebra: 1, alpha: 2, middle: 3 },
    }))

    expect(changes.map((c) => c.field)).toEqual(['alpha', 'middle', 'zebra'])
  })
})

describe('how a value is shown', () => {
  test('a string is itself; a number, boolean or object is JSON', () => {
    expect(formatValue('booked')).toBe('booked')
    expect(formatValue(9000)).toBe('9000')
    expect(formatValue(true)).toBe('true')
    expect(formatValue({ vat_number: 'EL123' })).toBe('{"vat_number":"EL123"}')
    expect(formatValue(['a', 'b'])).toBe('["a","b"]')
  })

  test('null and undefined are both "no value"', () => {
    expect(formatValue(null)).toBeNull()
    expect(formatValue(undefined)).toBeNull()
  })

  test('a long value is truncated, because app_settings.company holds the whole contract', () => {
    const terms = 'Ο μισθωτής υποχρεούται '.repeat(400)
    const shown = formatValue(terms)!

    expect(shown.length).toBe(MAX_VALUE_LENGTH + 1)   // + the ellipsis
    expect(shown.endsWith('…')).toBe(true)
    expect(terms.startsWith(shown.slice(0, -1))).toBe(true)
  })

  test('a value exactly at the limit is not truncated', () => {
    const exact = 'x'.repeat(MAX_VALUE_LENGTH)
    expect(formatValue(exact)).toBe(exact)
  })
})
