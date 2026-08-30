/**
 * Imports the fleet CSV into `cars`.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/import-fleet.ts fleet.csv [--apply]
 *
 * Without --apply it reports what it would do and changes nothing. That is the
 * default on purpose: the client's list arrives once, and a dry run over a
 * hundred plates is cheaper than an undo.
 *
 * Models are matched on make + model and are NOT created here. A car whose
 * model is not already in `car_models` is reported, not invented — the models
 * carry a category, and the category decides both the price and the minimum
 * driver age. Guessing one would be guessing at money and at eligibility.
 */
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { parseFleetCsv } from '../src/lib/fleet/csv'

const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const apply = process.argv.includes('--apply')
const url = process.env.DATABASE_URL

if (!file || !url) {
  console.error('Usage: DATABASE_URL=... npx tsx scripts/import-fleet.ts <file.csv> [--apply]')
  process.exit(1)
}

const { rows, issues } = parseFleetCsv(readFileSync(file, 'utf8'))

for (const issue of issues) {
  console.error(
    `  line ${issue.line}: ${issue.code}${issue.column ? ` (${issue.column})` : ''}` +
    `${issue.value ? ` — "${issue.value}"` : ''}`)
}

if (issues.some((i) => i.code === 'missing_column' || i.code === 'empty')) {
  console.error('\nThe file header is wrong. Nothing read.')
  process.exit(1)
}

const client = new Client({ connectionString: url })
await client.connect()

try {
  const models = await client.query<{ id: string; make: string; model: string }>(
    'select id, make, model from public.car_models')

  const key = (make: string, model: string) => `${make.toLowerCase()}|${model.toLowerCase()}`
  const byName = new Map(models.rows.map((m) => [key(m.make, m.model), m.id]))

  const existing = await client.query<{ plate: string }>('select plate from public.cars')
  const known = new Set(existing.rows.map((r) => r.plate))

  const ready: { row: (typeof rows)[number]; modelId: string }[] = []
  const unknownModels = new Set<string>()
  let alreadyThere = 0

  for (const row of rows) {
    const modelId = byName.get(key(row.make, row.model))
    if (!modelId) {
      unknownModels.add(`${row.make} ${row.model}`)
      continue
    }
    if (known.has(row.plate)) {
      alreadyThere++
      continue
    }
    ready.push({ row, modelId })
  }

  console.log(`\n  read        ${rows.length}`)
  console.log(`  ready       ${ready.length}`)
  console.log(`  already in  ${alreadyThere}`)
  console.log(`  rejected    ${issues.filter((i) => i.code !== 'missing_column').length}`)

  if (unknownModels.size > 0) {
    console.log(`\n  Models not in car_models — add them, with a category, before importing:`)
    for (const name of [...unknownModels].sort()) console.log(`    ${name}`)
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.')
  } else if (ready.length > 0) {
    await client.query('begin')
    for (const { row, modelId } of ready) {
      await client.query(
        `insert into public.cars (plate, model_id, year, colour) values ($1, $2, $3, $4)`,
        [row.plate, modelId, row.year, row.colour])
    }
    await client.query('commit')
    console.log(`\nImported ${ready.length} cars.`)
  }
} catch (err) {
  await client.query('rollback').catch(() => {})
  console.error('\nFailed, rolled back:', (err as Error).message)
  process.exitCode = 1
} finally {
  await client.end()
}
