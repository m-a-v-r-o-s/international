import { describe, expect, test } from 'vitest'
import { parseFleetCsv } from '../../src/lib/fleet/csv'

describe('the fleet import', () => {
  test('reads the agreed columns', () => {
    const { rows, issues } = parseFleetCsv(
      'plate,make,model,year,colour\n' +
      'ABC-1234,Fiat,Panda,2023,White\n' +
      'ABD-5678,Toyota,Yaris,2022,Silver\n')

    expect(issues).toEqual([])
    expect(rows).toEqual([
      { line: 2, plate: 'ABC-1234', make: 'Fiat', model: 'Panda', year: 2023, colour: 'white' },
      { line: 3, plate: 'ABD-5678', make: 'Toyota', model: 'Yaris', year: 2022, colour: 'silver' },
    ])
  })

  test('reads a Greek spreadsheet: Greek headers, semicolons, a BOM', () => {
    const { rows, issues } = parseFleetCsv(
      '﻿Πινακίδα;Μάρκα;Μοντέλο;Έτος;Χρώμα\n' +
      'ΡΘΚ-1234;Fiat;Panda;2023;λευκό\n')

    expect(issues).toEqual([])
    expect(rows[0]).toMatchObject({ plate: 'ΡΘΚ-1234', make: 'Fiat', year: 2023 })
  })

  test('handles quoted fields with the delimiter inside them', () => {
    const { rows } = parseFleetCsv(
      'plate,make,model,year,colour\n' +
      '"ABC-1","Mercedes","A-Class, AMG line",2024,"grey"\n')

    expect(rows[0]).toMatchObject({ model: 'A-Class, AMG line', make: 'Mercedes' })
  })

  test('year and colour are optional; plate, make and model are not', () => {
    const { rows, issues } = parseFleetCsv(
      'plate,make,model\nABC-1,Fiat,Panda\n')
    expect(issues).toEqual([])
    expect(rows[0]).toMatchObject({ year: null, colour: null })

    const missing = parseFleetCsv('plate,make\nABC-1,Fiat\n')
    expect(missing.issues).toEqual([{ line: 1, column: 'model', code: 'missing_column' }])
  })

  test('a bad row is reported with its line number, not dropped or coerced', () => {
    const { rows, issues } = parseFleetCsv(
      'plate,make,model,year\n' +
      'ABC-1,Fiat,Panda,2023\n' +
      ',Fiat,Panda,2023\n' +
      'ABC-3,Fiat,Panda,1899\n')

    expect(rows.map((r) => r.plate)).toEqual(['ABC-1'])
    expect(issues).toEqual([
      { line: 3, column: 'plate', code: 'invalid', value: '' },
      { line: 4, column: 'year', code: 'invalid', value: '1899' },
    ])
  })

  test('the same plate twice is a mistake in the spreadsheet, not two cars', () => {
    const { rows, issues } = parseFleetCsv(
      'plate,make,model\nABC-1,Fiat,Panda\nabc-1,Fiat,Panda\n')

    expect(rows).toHaveLength(1)
    expect(issues).toEqual([
      { line: 3, column: 'plate', code: 'duplicate_plate', value: 'ABC-1' },
    ])
  })

  test('an empty file says so rather than importing nothing quietly', () => {
    expect(parseFleetCsv('   \n\n').issues).toEqual([{ line: 0, code: 'empty' }])
  })
})
