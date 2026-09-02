import { describe, expect, test } from 'vitest'
import { parseBulkPaste } from '../../src/lib/pricing/bulk-paste'

const CODES = new Set(['A', 'B', 'C'])

describe('parseBulkPaste', () => {
  test('reads a tab-separated block, category codes upper-cased', () => {
    const result = parseBulkPaste(
      'a\t35\t65\t90\t115\t140\t160\t180\t25\n' +
      'B\t40\t75\t105\t135\t165\t190\t215\t30',
      CODES,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({
      line: 1, categoryCode: 'A',
      euros: [35, 65, 90, 115, 140, 160, 180, 25],
    })
    expect(result.rows[1]!.euros).toEqual([40, 75, 105, 135, 165, 190, 215, 30])
  })

  test('accepts comma and semicolon separators', () => {
    const result = parseBulkPaste('A,35,65,90,115,140,160,180,25', CODES)
    expect(result.ok).toBe(true)
    const semi = parseBulkPaste('A;35;65;90;115;140;160;180;25', CODES)
    expect(semi.ok).toBe(true)
    if (!semi.ok) return
    expect(semi.rows[0]!.euros[0]).toBe(35)
  })

  test('rejects a decimal amount — whole euros only', () => {
    const result = parseBulkPaste('A\t35.50\t65\t90\t115\t140\t160\t180\t25', CODES)
    expect(result).toEqual({ ok: false, badLine: 1 })
  })

  test('rejects an unknown category code, with the line number', () => {
    const result = parseBulkPaste('Z\t1\t2\t3\t4\t5\t6\t7\t8', CODES)
    expect(result).toEqual({ ok: false, badLine: 1 })
  })

  test('rejects a row with the wrong number of values', () => {
    const result = parseBulkPaste('A\t1\t2\t3', CODES)
    expect(result).toEqual({ ok: false, badLine: 1 })
  })

  test('rejects a non-numeric cell', () => {
    const result = parseBulkPaste('A\t1\t2\t3\t4\t5\t6\tseven\t8', CODES)
    expect(result).toEqual({ ok: false, badLine: 1 })
  })

  test('reports the correct line when an earlier line is fine and a later one is not', () => {
    const result = parseBulkPaste(
      'A\t1\t2\t3\t4\t5\t6\t7\t8\nB\t1\t2\t3\t4\t5\t6\t7', CODES)
    expect(result).toEqual({ ok: false, badLine: 2 })
  })

  test('blank lines are skipped, not counted', () => {
    const result = parseBulkPaste('\nA\t1\t2\t3\t4\t5\t6\t7\t8\n\n', CODES)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toHaveLength(1)
  })

  test('empty input is rejected', () => {
    expect(parseBulkPaste('   \n  ', CODES)).toEqual({ ok: false, badLine: 0 })
  })
})
