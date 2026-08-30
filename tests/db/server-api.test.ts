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
