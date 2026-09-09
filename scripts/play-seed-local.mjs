/*
  Sets up a LOCAL Supabase stack (`npx supabase start`) as the backing store for
  the Play Store screenshots in docs/08-PLAY-STORE.md §A6.

  It exists because the screenshots need a database that looks like a working
  August morning, and neither of the databases this project already has is that:
  the hosted testing project holds the client's own smoke-test accounts and
  hand-entered fleet, and dev-seed.sql names every category "PLACEHOLDER".

    npx supabase start
    node scripts/play-seed-local.mjs
    node scripts/play-screenshots.mjs

  Creates two accounts, applies supabase/seed/listing-seed.sql, and prints the
  credentials the screenshot run signs in with. Local stack only: it reads the
  fixed local anon/service keys and refuses to run against anything else.
*/
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { Client } from 'pg'
import { hash } from '@node-rs/argon2'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const API = 'http://127.0.0.1:54321'

export const ACCOUNTS = {
  admin: { email: 'boss@internationalrentals.test', password: 'screenshot-admin-4f2a9c', name: 'Νίκος Μαυρίδης', lang: 'en' },
  rep:   { email: 'rep@internationalrentals.test',  password: 'screenshot-rep-71bd3e',   name: 'Μαρία Σταυράκη', lang: 'en', pin: '481902' },
}

function localStatus() {
  const raw = execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' })
  return JSON.parse(raw.slice(raw.indexOf('{')))
}

/**
 * Create the account, or reset its password if it is already there.
 *
 * Deleting and recreating would be simpler and does not work: a profile is
 * referenced by `bookings.created_by` and by every `audit_log` row it ever
 * wrote, so the second run of this script would fail on a foreign key. The
 * accounts are made idempotent instead.
 */
async function upsertUser(serviceKey, { email, password }) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  }

  const found = await fetch(
    `${API}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, { headers })
  const existing = (await found.json())?.users?.find((u) => u.email === email)

  const res = existing
    ? await fetch(`${API}/auth/v1/admin/users/${existing.id}`, {
        method: 'PUT', headers, body: JSON.stringify({ password, email_confirm: true }),
      })
    : await fetch(`${API}/auth/v1/admin/users`, {
        method: 'POST', headers, body: JSON.stringify({ email, password, email_confirm: true }),
      })

  const body = await res.json()
  if (!res.ok) throw new Error(`upsert ${email}: ${res.status} ${JSON.stringify(body)}`)
  return body.id
}

// Importable for its ACCOUNTS alone (scripts/play-screenshots.mjs does that),
// so nothing below runs unless this file is the one being executed.
if (import.meta.filename !== process.argv[1]) {
  // eslint-disable-next-line no-empty
} else {
const status = localStatus()
if (!status.API_URL?.includes('127.0.0.1')) {
  throw new Error('this only runs against a local `supabase start` stack')
}

const db = new Client({ connectionString: DB })
await db.connect()

const adminId = await upsertUser(status.SERVICE_ROLE_KEY, ACCOUNTS.admin)
const repId = await upsertUser(status.SERVICE_ROLE_KEY, ACCOUNTS.rep)

await db.query(
  `update public.profiles set role='admin', full_name=$2, lang=$3, active=true where id=$1`,
  [adminId, ACCOUNTS.admin.name, ACCOUNTS.admin.lang])

// The rep's shift PIN, argon2id at the same OWASP parameters src/lib/auth/pin.ts
// hashes with, because that is what the unlock screen will verify against.
const pinHash = await hash(ACCOUNTS.rep.pin, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
await db.query(
  `update public.profiles
   set role='rep', full_name=$2, lang=$3, active=true, pin_hash=$4, pin_must_change=false
   where id=$1`,
  [repId, ACCOUNTS.rep.name, ACCOUNTS.rep.lang, pinHash])

// A screenshot run signs in four times (two roles, two languages) and a
// re-run does it again inside the same 15-minute window, which is exactly what
// the login limiter is there to stop. Clearing the buckets is safe here and
// only here: this is a throwaway local stack with two invented accounts on it.
await db.query('delete from app.rate_limits')

await db.query(readFileSync('supabase/seed/listing-seed.sql', 'utf8'))

const { rows } = await db.query(
  `select (select count(*) from public.cars) cars,
          (select count(*) from public.bookings) bookings,
          (select count(*) from public.hotel_reps where profile_id=$1) rep_hotels`, [repId])
await db.end()

console.log(JSON.stringify({ ...rows[0], adminId, repId }, null, 2))
console.log(`\nadmin  ${ACCOUNTS.admin.email}  ${ACCOUNTS.admin.password}`)
console.log(`rep    ${ACCOUNTS.rep.email}  ${ACCOUNTS.rep.password}  PIN ${ACCOUNTS.rep.pin}`)
}
