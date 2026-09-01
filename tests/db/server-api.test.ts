import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, type Fixtures } from '../helpers/fixtures'

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

describe('the server-only API', () => {
  test('a rep session cannot reach any of it', async () => {
    await db.asUser(f.repA, async () => {
      expect(await errcode(() => db.sql(
        `select public.rate_limit_hit('x', 1, 60)`))).toBe('42501')
      expect(await errcode(() => db.sql(
        `select public.log_security_event('login_failed')`))).toBe('42501')
      expect(await errcode(() => db.sql(
        `select public.bind_rep_device($1, 'aaaaaaaaaaaaaaaaaaaa')`, [f.repA]))).toBe('42501')
      expect(await errcode(() => db.sql(
        `select public.rep_device_matches($1, 'aaaaaaaaaaaaaaaaaaaa')`, [f.repA]))).toBe('42501')
      expect(await errcode(() => db.sql(
        `select public.set_pin_hash($1, 'pretend-hash')`, [f.repA]))).toBe('42501')
      expect(await errcode(() => db.sql(
        `select public.role_for_email('boss@example.com')`))).toBe('42501')
      expect(await errcode(() => db.sql(
        `select * from public.credential_lookup_for_email('rep-a@example.com')`))).toBe('42501')
    })
  })

  /**
   * The read behind PIN-only sign-in (docs/01-DECISIONS.md §32). It is the one
   * function in this file that hands back a credential hash, so what it answers
   * and to whom is asserted rather than assumed.
   */
  describe('credential_lookup_for_email', () => {
    test('resolves an address to the row the sign-in needs', async () => {
      await db.as({ kind: 'service' }, async () => {
        await db.sql(`select public.set_pin_hash($1, 'argon2-hash-stand-in')`, [f.repA])

        const row = await db.one<{
          id: string; role: string; active: boolean; pin_hash: string | null
        }>(`select * from public.credential_lookup_for_email('  REP-A@Example.com ')`)

        // Trimmed and case-folded, exactly like role_for_email — the boss types
        // a rep's address into the create form however he likes.
        expect(row.id).toBe(f.repA)
        expect(row.role).toBe('rep')
        expect(row.active).toBe(true)
        expect(row.pin_hash).toBe('argon2-hash-stand-in')
      })
    })

    test('answers nothing for an address that does not exist', async () => {
      await db.as({ kind: 'service' }, async () => {
        const rows = await db.sql(
          `select * from public.credential_lookup_for_email('nobody@example.com')`)
        expect(rows).toEqual([])
      })
    })

    /**
     * The deliberate difference from role_for_email(), which filters to active
     * accounts and so cannot tell a deactivated rep from a stranger. The login
     * screen needs that distinction to say "ask the manager to reactivate it"
     * instead of "wrong PIN" — and it only says it once the PIN has verified,
     * so nothing about it is reachable without the credential.
     */
    test('still answers for a deactivated account, and says so', async () => {
      await db.as({ kind: 'service' }, async () => {
        const row = await db.one<{ role: string; active: boolean }>(
          `select * from public.credential_lookup_for_email('gone@example.com')`)
        expect(row.role).toBe('rep')
        expect(row.active).toBe(false)
      })
    })

    test('reports the admin as an admin, so the PIN path can refuse him', async () => {
      await db.as({ kind: 'service' }, async () => {
        const row = await db.one<{ role: string }>(
          `select * from public.credential_lookup_for_email('boss@example.com')`)
        expect(row.role).toBe('admin')
      })
    })
  })

  test('role_for_email tells the server which sign-in path to use', async () => {
    await db.as({ kind: 'service' }, async () => {
      expect((await db.one<{ r: string | null }>(
        `select public.role_for_email('boss@example.com') as r`)).r).toBe('admin')
      expect((await db.one<{ r: string | null }>(
        `select public.role_for_email('  REP-A@Example.com ') as r`)).r).toBe('rep')
      // Unknown and deactivated addresses are indistinguishable from each other.
      expect((await db.one<{ r: string | null }>(
        `select public.role_for_email('nobody@example.com') as r`)).r).toBeNull()
      expect((await db.one<{ r: string | null }>(
        `select public.role_for_email('gone@example.com') as r`)).r).toBeNull()
    })
  })

  test('rate limiting counts within a window and then refuses', async () => {
    await db.as({ kind: 'service' }, async () => {
      const results: boolean[] = []
      for (let i = 0; i < 5; i++) {
        const { ok } = await db.one<{ ok: boolean }>(
          `select public.rate_limit_hit('login:test', 3, 60) as ok`)
        results.push(ok)
      }
      expect(results).toEqual([true, true, true, false, false])
    })
  })

  test('device binding is one per rep, and a stale device stops matching', async () => {
    await db.as({ kind: 'service' }, async () => {
      const first = await db.one<{ replaced: boolean }>(
        `select public.bind_rep_device($1, 'device-one-0000000000', 'Pixel') as replaced`, [f.repA])
      expect(first.replaced).toBe(false)

      expect((await db.one<{ ok: boolean }>(
        `select public.rep_device_matches($1, 'device-one-0000000000') as ok`, [f.repA])).ok).toBe(true)

      const second = await db.one<{ replaced: boolean }>(
        `select public.bind_rep_device($1, 'device-two-0000000000', 'Galaxy') as replaced`, [f.repA])
      expect(second.replaced).toBe(true)

      expect((await db.one<{ ok: boolean }>(
        `select public.rep_device_matches($1, 'device-one-0000000000') as ok`, [f.repA])).ok).toBe(false)
    })
  })

  test('security events never carry a raw email or a token', async () => {
    await db.as({ kind: 'service' }, () => db.sql(
      `select public.log_security_event('login_failed', null, 'sha256-of-email', 'sha256-of-ip',
                                        jsonb_build_object('reason', 'bad_password'))`))

    const row = await db.one<{ kind: string; email_hash: string; detail: Record<string, string> }>(
      `select kind, email_hash, detail from app.auth_events order by id desc limit 1`)
    expect(row.kind).toBe('login_failed')
    expect(row.email_hash).toBe('sha256-of-email')
    expect(row.detail).toEqual({ reason: 'bad_password' })
  })
})
