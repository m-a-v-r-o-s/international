import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Client } from 'pg'

const MIGRATIONS_DIR = resolve('supabase/migrations')
const SHIM = resolve('tests/helpers/supabase-shim.sql')

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/**
 * Applies the Supabase shim and then every migration, in filename order — the
 * same files that get deployed. Nothing here is test-only SQL: if a migration
 * would fail on Supabase it fails here first.
 */
export async function applySchema(client: Client): Promise<void> {
  await client.query(readFileSync(SHIM, 'utf8'))

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    try {
      await client.query(sql)
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`)
    }
  }
}
