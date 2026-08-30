import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb } from '../helpers/db'
import { seed, type Fixtures } from '../helpers/fixtures'

// A10's contract half — `app_settings.company`, the jsonb column that holds
// the legal name, the ΑΦΜ, the address, the phone, the insurer and the
// bilingual terms the agreement prints (docs/01-DECISIONS.md §28.7, §16).
//
// It is not a secret — a rep hands the guest a contract with all of it printed
// on the front — so a rep may READ it. What a rep may not do is change the
// company's legal identity or the terms of an agreement a guest signs, and
// that is the boundary under test.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.sql(`update public.app_settings set company = '{}'::jsonb where id = 1`)
})

const company = () =>
  db.one<{ company: Record<string, string> }>(`select company from public.app_settings where id = 1`)

const REAL = {
  legal_name: 'PLACEHOLDER — not yet supplied by the client',
  vat_number: 'PLACEHOLDER',
  terms_el: 'PLACEHOLDER',
  terms_en: 'PLACEHOLDER',
}

describe('the boss owns the letterhead', () => {
  test('the admin writes the company details and the terms', async () => {
    await db.asUser(f.admin, () => db.sql(
      `update public.app_settings set company = $1::jsonb where id = 1`, [JSON.stringify(REAL)]))

    expect((await company()).company.legal_name).toBe(REAL.legal_name)
  })

  test('a rep cannot — the policy simply matches no row, and nothing changes', async () => {
    await db.asUser(f.admin, () => db.sql(
      `update public.app_settings set company = $1::jsonb where id = 1`, [JSON.stringify(REAL)]))

    await db.asUser(f.repA, () => db.sql(
      `update public.app_settings
          set company = jsonb_build_object('legal_name', 'Rep A Rentals', 'vat_number', '000')
        where id = 1`))

    expect((await company()).company.legal_name).toBe(REAL.legal_name)
  })

  test('nor can a rep change the retention window their photos are purged on', async () => {
    // §25: the window is admin-set. A rep who could raise it could keep a
    // scanned licence on file indefinitely.
    await db.asUser(f.repA, () => db.sql(
      `update public.app_settings set licence_retention_months = 120 where id = 1`))

    const row = await db.one<{ licence_retention_months: number }>(
      `select licence_retention_months from public.app_settings where id = 1`)
    expect(row.licence_retention_months).toBe(24)
  })

  test('but a rep CAN read it — the contract prints it on the front page', async () => {
    await db.asUser(f.admin, () => db.sql(
      `update public.app_settings set company = $1::jsonb where id = 1`, [JSON.stringify(REAL)]))

    const seen = await db.asUser(f.repA, () => db.one<{ company: Record<string, string> }>(
      `select company from public.app_settings where id = 1`))
    expect(seen.company.legal_name).toBe(REAL.legal_name)
  })

  test('every change to it is audit-logged, like every other write', async () => {
    await db.sql(`delete from public.audit_log where entity = 'app_settings'`)

    await db.asUser(f.admin, () => db.sql(
      `update public.app_settings set company = $1::jsonb where id = 1`, [JSON.stringify(REAL)]))

    const entries = await db.sql<{ actor_id: string; action: string }>(
      `select actor_id, action from public.audit_log where entity = 'app_settings'`)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.actor_id).toBe(f.admin)
    expect(entries[0]?.action).toBe('update')
  })
})

describe('the column starts empty, and stays empty until the client supplies it', () => {
  test('a fresh database has no company details and no terms', async () => {
    // Nothing in supabase/migrations or the dev seed puts a value here. An
    // invented ΑΦΜ or a drafted set of Greek rental terms would be a
    // plausible-looking falsehood on a document a guest signs.
    const fresh = await TestDb.create()
    try {
      const row = await fresh.one<{ company: Record<string, unknown> }>(
        `select company from public.app_settings where id = 1`)
      expect(row.company).toEqual({})
    } finally {
      await fresh.close()
    }
  })
})
