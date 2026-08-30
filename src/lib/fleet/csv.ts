import { z } from 'zod'

/**
 * Fleet import.
 *
 * The client is sending ~100 cars as a spreadsheet (docs/01-DECISIONS.md §28.3).
 * It has not arrived, so this parses the shape that was agreed — plate, make,
 * model, year, colour — and is deliberately forgiving about everything that
 * varies between one person's spreadsheet and another's: header case, Greek or
 * English column names, semicolon separators (which is what Excel produces on a
 * Greek locale), quoted fields and a UTF-8 byte-order mark.
 *
 * It is not forgiving about the data itself. Every row is validated, and a bad
 * row is reported with its line number rather than quietly dropped or quietly
 * coerced.
 */
export type FleetRow = {
  line: number
  plate: string
  make: string
  model: string
  year: number | null
  colour: string | null
}

export type FleetIssue = {
  line: number
  column?: string
  code: 'missing_column' | 'empty' | 'invalid' | 'duplicate_plate'
  value?: string
}

export type FleetParseResult = {
  rows: FleetRow[]
  issues: FleetIssue[]
}

const HEADERS: Record<keyof Omit<FleetRow, 'line'>, string[]> = {
  plate: ['plate', 'πινακιδα', 'αριθμοσ κυκλοφοριασ'],
  make: ['make', 'brand', 'μαρκα', 'κατασκευαστησ'],
  model: ['model', 'μοντελο', 'τυποσ'],
  year: ['year', 'ετοσ', 'χρονολογια'],
  colour: ['colour', 'color', 'χρωμα'],
}

const REQUIRED: (keyof Omit<FleetRow, 'line'>)[] = ['plate', 'make', 'model']

const rowSchema = z.object({
  plate: z.string().trim().min(2).max(16),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: z.number().int().min(1980).max(2100).nullable(),
  colour: z.string().trim().min(1).max(40).nullable(),
})

export function parseFleetCsv(input: string): FleetParseResult {
  const text = input.replace(/^﻿/, '')
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '')
  const issues: FleetIssue[] = []
  const rows: FleetRow[] = []

  if (lines.length === 0) {
    return { rows, issues: [{ line: 0, code: 'empty' }] }
  }

  const delimiter = detectDelimiter(lines[0]!)
  const header = splitLine(lines[0]!, delimiter).map(normaliseHeader)
  const index = mapColumns(header)

  for (const column of REQUIRED) {
    if (index[column] === undefined) {
      issues.push({ line: 1, column, code: 'missing_column' })
    }
  }
  if (issues.length > 0) return { rows, issues }

  const seen = new Map<string, number>()

  for (let i = 1; i < lines.length; i++) {
    const line = i + 1
    const cells = splitLine(lines[i]!, delimiter)
    const cell = (column: keyof typeof index) => {
      const at = index[column]
      return at === undefined ? '' : (cells[at] ?? '').trim()
    }

    const yearText = cell('year')
    const parsed = rowSchema.safeParse({
      plate: normalisePlate(cell('plate')),
      make: cell('make'),
      model: cell('model'),
      year: yearText === '' ? null : Number.parseInt(yearText, 10),
      colour: cell('colour') === '' ? null : cell('colour').toLowerCase(),
    })

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          line,
          column: String(issue.path[0] ?? ''),
          code: 'invalid',
          value: cell(issue.path[0] as keyof typeof index),
        })
      }
      continue
    }

    // A plate is unique in the fleet; the same car twice in one file is a
    // mistake in the spreadsheet, not two cars.
    const previous = seen.get(parsed.data.plate)
    if (previous !== undefined) {
      issues.push({ line, column: 'plate', code: 'duplicate_plate', value: parsed.data.plate })
      continue
    }
    seen.set(parsed.data.plate, line)
    rows.push({ line, ...parsed.data })
  }

  return { rows, issues }
}

/** Excel on a Greek locale writes semicolons; everyone else writes commas. */
function detectDelimiter(headerLine: string): string {
  const semis = (headerLine.match(/;/g) ?? []).length
  const commas = (headerLine.match(/,/g) ?? []).length
  const tabs = (headerLine.match(/\t/g) ?? []).length
  if (tabs > semis && tabs > commas) return '\t'
  return semis > commas ? ';' : ','
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i++ } else { quoted = false }
      } else {
        current += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      out.push(current)
      current = ''
    } else {
      current += char
    }
  }
  out.push(current)
  return out
}

/**
 * Lower-case, unaccented, punctuation-free, and with the Greek final sigma
 * folded to a plain one — so "Πινακίδα", "ΠΙΝΑΚΙΔΑ" and "plate" all land on the
 * same key, and "Έτος" does not miss "ετος" over a ς.
 */
function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u03c2/g, '\u03c3')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
}

function normalisePlate(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase()
}

function mapColumns(header: string[]): Partial<Record<keyof Omit<FleetRow, 'line'>, number>> {
  const index: Partial<Record<keyof Omit<FleetRow, 'line'>, number>> = {}
  for (const [field, names] of Object.entries(HEADERS) as [
    keyof Omit<FleetRow, 'line'>, string[],
  ][]) {
    const at = header.findIndex((h) => names.includes(h))
    if (at >= 0) index[field] = at
  }
  return index
}
