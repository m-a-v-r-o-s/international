/**
 * Parses a bulk-pasted price table (A4, docs/04-SCREENS.md): one line per
 * category — the category code, then 8 numbers (the 1–7 day totals, then the
 * extra-day rate) — tab, comma or semicolon separated, exactly what selecting
 * a block of cells in a spreadsheet and pasting produces.
 *
 * Pulled out of the server action so the parsing rules can be tested without
 * a database, the same way src/lib/fleet/csv.ts is separated from
 * scripts/import-fleet.ts.
 */
export type BulkPasteRow = {
  line: number
  categoryCode: string
  /** Index 0..6 are the 1..7 day totals; index 7 is the extra-day rate. Cents. */
  cents: [number, number, number, number, number, number, number, number]
}

export type BulkPasteResult =
  | { ok: true; rows: BulkPasteRow[] }
  | { ok: false; badLine: number }

const NUMBER = /^\d+([.,]\d{1,2})?$/

/**
 * One delimiter for the whole line, chosen from what actually separates the
 * 9 fields — never split on every candidate character at once, or a
 * comma-decimal total ("35,50") gets sliced in half by the same regex that is
 * supposed to separate cells (this is the bug `src/lib/fleet/csv.ts` already
 * had to solve for Excel's Greek-locale semicolons).
 */
function detectDelimiter(line: string): string {
  const tabs = (line.match(/\t/g) ?? []).length
  if (tabs >= 8) return '\t'
  const semis = (line.match(/;/g) ?? []).length
  const commas = (line.match(/,/g) ?? []).length
  return semis >= 8 && semis >= commas ? ';' : ','
}

export function parseBulkPaste(text: string, knownCodes: Set<string>): BulkPasteResult {
  const lines = text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return { ok: false, badLine: 0 }

  const rows: BulkPasteRow[] = []

  for (let i = 0; i < lines.length; i++) {
    const delimiter = detectDelimiter(lines[i]!)
    const cells = lines[i]!.split(delimiter).map((c) => c.trim())
    const [code, ...numbers] = cells
    const categoryCode = code ? code.toUpperCase() : ''

    if (!categoryCode || !knownCodes.has(categoryCode)
        || numbers.length !== 8 || numbers.some((n) => !NUMBER.test(n))) {
      return { ok: false, badLine: i + 1 }
    }

    const cents = numbers.map((n) => Math.round(Number.parseFloat(n.replace(',', '.')) * 100))
    rows.push({
      line: i + 1,
      categoryCode,
      cents: cents as BulkPasteRow['cents'],
    })
  }

  return { ok: true, rows }
}
