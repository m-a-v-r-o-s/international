import { beforeAll, afterAll, expect, test } from 'vitest'
import { TestDb } from '../helpers/db'

let db: TestDb

beforeAll(async () => { db = await TestDb.create() })
afterAll(async () => { await db?.close() })

test('every migration applies and the exclusion constraint exists', async () => {
  const rows = await db.sql<{ conname: string }>(
    `select conname from pg_constraint where conname = 'no_double_booking'`)
  expect(rows).toHaveLength(1)
})

test('RLS is enabled on every table in public', async () => {
  const rows = await db.sql<{ tablename: string }>(
    `select c.relname as tablename
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
  expect(rows.map((r) => r.tablename)).toEqual([])
})
