/**
 * Applies every migration in supabase/migrations to the database in DATABASE_URL,
 * in filename order, inside one transaction.
 *
 *   DATABASE_URL=postgres://... npm run db:reset -- [--seed]
 *
 * This is for a fresh Supabase project or a local branch database. It does not
 * track which migrations have already run — the Supabase CLI does that for
 * deployments; this is the "set up a new environment" path.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Client } from 'pg'
import { migrationFiles } from '../tests/helpers/schema'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const withSeed = process.argv.includes('--seed')

const client = new Client({ connectionString: url })
await client.connect()

try {
  await client.query('begin')
  for (const file of migrationFiles()) {
    process.stdout.write(`  ${file} … `)
    await client.query(readFileSync(join(resolve('supabase/migrations'), file), 'utf8'))
    console.log('ok')
  }
  if (withSeed) {
    process.stdout.write('  dev-seed.sql … ')
    await client.query(readFileSync(resolve('supabase/seed/dev-seed.sql'), 'utf8'))
    console.log('ok')
  }
  await client.query('commit')
  console.log('\nDone.')
} catch (err) {
  await client.query('rollback')
  console.error('\nFailed, rolled back:', (err as Error).message)
  process.exitCode = 1
} finally {
  await client.end()
}
