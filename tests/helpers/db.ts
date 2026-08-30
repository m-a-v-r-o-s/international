import { randomUUID } from 'node:crypto'
import pg, { Client } from 'pg'
import { inject } from 'vitest'

// `date` means a calendar date here, never an instant. node-postgres would
// otherwise hand back a JS Date at local midnight and every assertion would
// quietly shift by the machine's UTC offset — which is exactly the class of bug
// the inclusive-day rule cannot afford. Keep dates as the strings Postgres sent.
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v)
// pg-types' TypeId enum has no member for date[] (OID 1182), so the OID goes in
// by hand. Dates in an array are plain YYYY-MM-DD with no quoting to undo.
// @ts-expect-error -- see above
pg.types.setTypeParser(1182, (v: string) => (v === '{}' ? [] : v.slice(1, -1).split(',')))

export type Identity =
  | { kind: 'owner' }                                   // superuser: fixture setup only
  | { kind: 'service' }                                 // Supabase service_role
  | { kind: 'anon' }                                    // logged out
  | { kind: 'user'; uid: string }                       // a signed-in rep or admin

/**
 * One throwaway database per test file, cloned from the migrated template.
 * Identity switching mirrors what PostgREST does on a real request: SET ROLE to
 * `authenticated` and put the JWT claims in `request.jwt.claims`, so the
 * policies under test are the policies that will run in production.
 */
export class TestDb {
  private constructor(
    readonly name: string,
    readonly client: Client,
    private readonly port: number,
  ) {}

  static async create(): Promise<TestDb> {
    const port = inject('pgPort')
    const template = inject('templateDb')
    const name = `ir_${randomUUID().replace(/-/g, '')}`.slice(0, 40)

    const admin = new Client({
      host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres',
    })
    await admin.connect()
    await admin.query(`create database ${name} template ${template}`)
    await admin.end()

    const client = new Client({
      host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: name,
    })
    await client.connect()
    return new TestDb(name, client, port)
  }

  /** A second live connection to the same database — for the racing-writes test. */
  async connect(): Promise<Client> {
    const c = new Client({
      host: '127.0.0.1', port: this.port, user: 'postgres', password: 'postgres',
      database: this.name,
    })
    await c.connect()
    return c
  }

  async sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.client.query(text, params)
    return res.rows as T[]
  }

  async one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
    const rows = await this.sql<T>(text, params)
    const row = rows[0]
    if (rows.length !== 1 || row === undefined) {
      throw new Error(`expected exactly 1 row, got ${rows.length}`)
    }
    return row
  }

  /** Run as an identity, then always drop back to the fixture superuser. */
  async as<T>(id: Identity, fn: () => Promise<T>): Promise<T> {
    await become(this.client, id)
    try {
      return await fn()
    } finally {
      await become(this.client, { kind: 'owner' })
    }
  }

  /** Convenience: everything a signed-in staff member does. */
  asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    return this.as({ kind: 'user', uid }, fn)
  }

  async close(): Promise<void> {
    await this.client.end()
  }
}

export async function become(client: Client, id: Identity): Promise<void> {
  await client.query('reset role')
  switch (id.kind) {
    case 'owner':
      await client.query(`select set_config('request.jwt.claims', '', false)`)
      return
    case 'service':
      await client.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ role: 'service_role' }),
      ])
      await client.query('set role service_role')
      return
    case 'anon':
      await client.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ role: 'anon' }),
      ])
      await client.query('set role anon')
      return
    case 'user':
      await client.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ sub: id.uid, role: 'authenticated' }),
      ])
      await client.query('set role authenticated')
      return
  }
}

/** The SQLSTATE of a rejected statement — how the app tells IR100 from IR104. */
export async function errcode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (err) {
    return (err as { code?: string }).code ?? 'no-code'
  }
  throw new Error('expected the statement to be rejected, but it succeeded')
}
