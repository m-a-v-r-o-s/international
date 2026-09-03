import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'
import { seed, type Fixtures } from '../helpers/fixtures'

// `public.accountant_replies` and the `accountant-files` bucket
// (supabase/migrations/20260903160000_accountant_questionnaire.sql).
//
// This table is unlike every other one in the schema in the way that matters
// most for a test: the FORM THAT FILLS IT IS PUBLIC. /accountant-questionnaire
// takes a POST from somebody the database has never heard of, so the thing
// worth asserting is not who can read a row but that the reachable roles can
// write NOTHING. If `anon` ever gains an insert here, the app has an
// unauthenticated arbitrary-jsonb write endpoint, and no amount of validation
// in the server action would matter, because the action would no longer be the
// only way in.
//
// Everything below therefore runs as a real session under RLS, the same way
// the rest of tests/db does. The service role writes are the app's own path
// and are asserted to still work, because a policy set tight enough to break
// them would be a silent outage rather than a leak.

let db: TestDb
let f: Fixtures

beforeAll(async () => {
  db = await TestDb.create()
  f = await seed(db)
})
afterAll(async () => { await db?.close() })

beforeEach(async () => {
  await db.sql(`delete from public.accountant_replies`)
  await db.sql(`delete from storage.objects where bucket_id = 'accountant-files'`)
})

/** A stored reply, written the way the server action writes one. */
async function storeReply(answers: Record<string, string> = { q1: 'Ναι, μέσω Epsilon.' }) {
  const row = await db.one<{ id: string }>(
    `insert into public.accountant_replies (answers, locale, ip_hash)
     values ($1::jsonb, 'el', 'deadbeef') returning id`,
    [JSON.stringify(answers)])
  return row.id
}

describe('accountant_replies · who may read', () => {
  test('the admin reads every reply', async () => {
    await storeReply()
    const rows = await db.asUser(f.admin, () =>
      db.sql(`select id from public.accountant_replies`))
    expect(rows).toHaveLength(1)
  })

  test('a rep sees nothing at all', async () => {
    await storeReply()
    const rows = await db.asUser(f.repA, () =>
      db.sql(`select id from public.accountant_replies`))
    expect(rows).toHaveLength(0)
  })

  test('a deactivated account sees nothing', async () => {
    await storeReply()
    const rows = await db.asUser(f.inactive, () =>
      db.sql(`select id from public.accountant_replies`))
    expect(rows).toHaveLength(0)
  })
})

describe('accountant_replies · nobody reachable may write', () => {
  // The whole point of the table's shape. An insert from a session is the
  // failure this migration exists to make impossible.
  test('anon cannot insert, even though the form is public', async () => {
    const code = await errcode(() => db.as({ kind: 'anon' }, () => db.sql(
      `insert into public.accountant_replies (answers) values ('{"q1":"x"}'::jsonb)`)))
    expect(code).toBe('42501')
  })

  test('a rep cannot insert', async () => {
    const code = await errcode(() => db.asUser(f.repA, () => db.sql(
      `insert into public.accountant_replies (answers) values ('{"q1":"x"}'::jsonb)`)))
    expect(code).toBe('42501')
  })

  test('even the admin cannot insert, update or delete', async () => {
    const id = await storeReply()

    // Reading is the admin's whole relationship with this table. A reply is a
    // record of what somebody outside the company said; an admin who could
    // edit one could rewrite the answer the build was based on.
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `insert into public.accountant_replies (answers) values ('{"q1":"x"}'::jsonb)`))))
      .toBe('42501')
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `update public.accountant_replies set respondent_name = 'edited' where id = $1`, [id]))))
      .toBe('42501')
    expect(await errcode(() => db.asUser(f.admin, () => db.sql(
      `delete from public.accountant_replies where id = $1`, [id]))))
      .toBe('42501')
  })

  test('the service role writes, which is the app\'s only path in', async () => {
    const id = await db.as({ kind: 'service' }, async () => {
      const row = await db.one<{ id: string }>(
        `insert into public.accountant_replies (answers, mail_status)
         values ('{"q1":"ναι"}'::jsonb, 'not_configured') returning id`)
      await db.sql(
        `update public.accountant_replies set mail_status = 'sent' where id = $1`, [row.id])
      return row.id
    })

    const row = await db.one<{ mail_status: string }>(
      `select mail_status from public.accountant_replies where id = $1`, [id])
    expect(row.mail_status).toBe('sent')
  })
})

describe('accountant_replies · the constraints the action relies on', () => {
  test('mail_status is one of three values', async () => {
    const code = await errcode(() => db.sql(
      `insert into public.accountant_replies (mail_status) values ('maybe')`))
    expect(code).toBe('23514')
  })

  test('answers must be an object, never an array or a bare string', async () => {
    for (const bad of ['[]', '"text"', '42']) {
      const code = await errcode(() => db.sql(
        `insert into public.accountant_replies (answers) values ($1::jsonb)`, [bad]))
      expect(code).toBe('23514')
    }
  })

  test('a full set of long Greek answers fits, which is why the cap is in bytes', async () => {
    // The regression this guards: 20 answers x 4000 characters is 80,000
    // characters and would pass a character-counted cap, but Greek is two
    // bytes per character in UTF-8, so the row is ~160 KB. A 64 KB cap would
    // have refused a legitimate reply in Greek and nowhere else.
    const long = 'α'.repeat(4000)
    const answers = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`q${i + 1}`, long]))

    const id = await storeReply(answers)
    const row = await db.one<{ n: number; bytes: number }>(
      `select count(*)::int as n, octet_length(r.answers::text) as bytes
         from public.accountant_replies r, jsonb_object_keys(r.answers)
        where r.id = $1
        group by r.answers`, [id])

    expect(row.n).toBe(20)
    // Measured the same way the CHECK measures it. If this ever drops under
    // 65536 the test has stopped proving anything about the cap it guards, so
    // it is asserted rather than merely survived.
    expect(row.bytes).toBeGreaterThan(65536)
  })

  test('at most twelve files are recorded against one reply', async () => {
    const files = JSON.stringify(Array.from({ length: 13 }, (_, i) => ({ path: `p${i}` })))
    const code = await errcode(() => db.sql(
      `insert into public.accountant_replies (files) values ($1::jsonb)`, [files]))
    expect(code).toBe('23514')
  })
})

describe('accountant-files bucket', () => {
  const BUCKET = 'accountant-files'

  /** An upload as the storage API performs one: an insert under the caller's JWT. */
  const put = (name: string) => db.sql(
    `insert into storage.objects (bucket_id, name, metadata)
     values ($1, $2, jsonb_build_object('mimetype', 'application/pdf'))`,
    [BUCKET, name])

  test('the bucket is private, capped, and takes only the four types', async () => {
    const row = await db.one<{
      public: boolean; file_size_limit: string; allowed_mime_types: string[]
    }>(`select public, file_size_limit, allowed_mime_types
          from storage.buckets where id = $1`, [BUCKET])

    expect(row.public).toBe(false)
    // bigint, so node-postgres hands it back as a string rather than losing precision.
    expect(Number(row.file_size_limit)).toBe(10 * 1024 * 1024)
    expect(row.allowed_mime_types.sort())
      .toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
  })

  test('nobody with a session may upload', async () => {
    expect(await errcode(() => db.as({ kind: 'anon' }, () => put('x/1.pdf')))).toBe('42501')
    expect(await errcode(() => db.asUser(f.repA, () => put('x/1.pdf')))).toBe('42501')
    expect(await errcode(() => db.asUser(f.admin, () => put('x/1.pdf')))).toBe('42501')
  })

  test('the admin reads what was sent in and a rep cannot', async () => {
    await db.as({ kind: 'service' }, () => put('reply-1/1-abc.pdf'))

    const asAdmin = await db.asUser(f.admin, () => db.sql(
      `select name from storage.objects where bucket_id = $1`, [BUCKET]))
    expect(asAdmin).toHaveLength(1)

    const asRep = await db.asUser(f.repA, () => db.sql(
      `select name from storage.objects where bucket_id = $1`, [BUCKET]))
    expect(asRep).toHaveLength(0)
  })
})
