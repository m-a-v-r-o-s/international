import { beforeAll, afterAll, expect, test } from 'vitest'
import { TestDb, errcode } from '../helpers/db'

/**
 * The grants themselves, asserted as facts about the catalogue.
 *
 * Every other db test asks what a POLICY decides. These ask the question one
 * layer underneath: whether a role can reach the function or the table at all.
 * That layer had no test, and it is where the first real Supabase project found
 * a hole — `anon` holding EXECUTE on twenty-three of this schema's own RPCs,
 * because Supabase's default privileges grant it explicitly to `anon` and ten
 * migrations withdrew it from `public` instead. Three of those RPCs answered an
 * unauthenticated caller with data.
 *
 * tests/helpers/supabase-shim.sql now installs those same default privileges,
 * so these tests fail without supabase/migrations/20260830200000_privileges.sql
 * rather than passing on a harness that was quietly stricter than production.
 */

let db: TestDb

beforeAll(async () => { db = await TestDb.create() })
afterAll(async () => { await db?.close() })

/**
 * Extension-owned functions are excluded, and the exclusion is a fact about
 * Supabase rather than a convenience. btree_gist and pgcrypto install ~190
 * functions into `public`; on a real project they are owned by
 * `supabase_admin`, so `revoke … from anon` running as `postgres` skips them
 * silently — it is not the owner and holds no grant option. They stay
 * executable by PUBLIC there, which is Postgres's own default for a function
 * everywhere. Nothing is lost by that: they are GiST support routines and
 * crypto primitives, pure computation over their arguments with no reach into
 * a table. What matters is that nothing THIS SCHEMA defines is on the list.
 */
test('anon can execute nothing this schema defines in public', async () => {
  const rows = await db.sql<{ fn: string }>(
    `select p.proname as fn
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       and not exists (
         select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     order by 1`)
  expect(rows.map((r) => r.fn)).toEqual([])
})

test('anon holds no privilege on any table in public', async () => {
  const rows = await db.sql<{ table_name: string; privilege_type: string }>(
    `select table_name, privilege_type
     from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon'
     order by 1, 2`)
  expect(rows).toEqual([])
})

/**
 * The three that were reachable. Named individually rather than left to the
 * sweep above, because a regression here is not "a grant drifted" — it is these
 * exact answers going back out to anyone holding the publishable key.
 */
test.each(['staff_hotels', 'booking_windows', 'rental_days'])(
  'anon cannot call public.%s()', async (fn) => {
    const rows = await db.sql<{ ok: boolean }>(
      `select has_function_privilege('anon', p.oid, 'EXECUTE') as ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`, [fn])
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.ok).toBe(false)
  })

test('a logged-out caller is refused by staff_hotels(), not answered by it', async () => {
  const code = await db.as({ kind: 'anon' }, () =>
    errcode(() => db.sql(`select * from public.staff_hotels()`)))
  expect(code).toBe('42501')
})

/**
 * `app` is not exposed through PostgREST, so this is defence in depth rather
 * than a live path — but 20260830090100_extensions.sql states it as a rule, and
 * a rule nothing checks is a comment.
 */
test('authenticated reaches only the named functions in app', async () => {
  const rows = await db.sql<{ fn: string }>(
    `select p.proname as fn
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     order by 1`)

  // Granted by name in 0001, 0008, 0011, 0016 and 0021. Everything else in
  // `app` — the trigger functions, the rate limiter, the security log, the
  // audit redactor — is the server's and the schema's own business.
  //
  // `phone_e164` is the odd one out and is here on purpose. It backs the
  // GENERATED column bookings.cust_phone_e164 (0021), and Postgres checks
  // EXECUTE on a generated column's expression against the role doing the
  // INSERT — so withholding it does not hide the function, it stops every rep
  // creating a booking. It is immutable, string in and string out, and reads
  // nothing.
  expect(rows.map((r) => r.fn)).toEqual([
    'assert_admin',
    'assert_staff',
    'can_read_booking',
    'can_read_handover',
    'current_role_name',
    'is_admin',
    'is_staff',
    'my_hotel_ids',
    'object_booking_id',
    'object_file_kind',
    'phone_e164',
    'rental_days',
    'today',
  ])
})

test('the rate limiter and the security log are not callable by a session', async () => {
  const rows = await db.sql<{ fn: string; auth_exec: boolean; anon_exec: boolean }>(
    `select p.proname as fn,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname in ('rate_limit_hit', 'rate_limit_sweep', 'log_security_event')
     order by 1`)

  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) {
    expect(row.auth_exec, `authenticated should not execute app.${row.fn}`).toBe(false)
    expect(row.anon_exec, `anon should not execute app.${row.fn}`).toBe(false)
  }
})
