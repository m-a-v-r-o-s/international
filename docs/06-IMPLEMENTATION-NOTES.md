# Implementation notes — Phases 0 and 1

What was built, the decisions the planning documents left open, and what is
still outstanding. `docs/01-DECISIONS.md` remains the authority; nothing here
contradicts it. Where a decision had to be made to get the work done, it is
recorded below rather than left implicit in the code.

## What is in

**Phase 0** — Next.js App Router + TypeScript + Tailwind v4, deployable to
Railway (`railway.json`). Design tokens tuned for a phone at a hotel desk in
sunlight, AA-checked. Greek and English from the first commit with no
hard-coded user-facing strings. Auth for both roles, session handling, the PIN
gate, one-device binding, CSP with a per-request nonce, HSTS and the rest of the
headers, cookie flags, and Postgres-backed rate limiting on every auth path.

**Phase 1** — the full schema, RLS on every table, the write guards, audit
logging, `availability()`, `quote()`, `check_eligibility()`, `my_cash_in_hand()`,
the admin-only RPCs, the fleet CSV import path, placeholder seed data, and 121
tests.

## Decisions taken while building

**i18n without locale routing.** `next-intl` resolves the language from a cookie
seeded from `profiles.lang`, not from a `/el` or `/en` URL prefix. This is an
internal app behind a login with `robots: noindex`, so the crawlability argument
for locale routing does not apply, and a TWA start URL with a language baked
into it would be wrong for a bilingual staff. If a public page is ever added,
that page — and only that page — should get proper locale routing.

**Column grants plus admin RPCs, rather than admin-only tables.** An admin holds
the same `authenticated` database role as a rep, so a column grant cannot tell
them apart. The fields a rep must never receive — `cars.notes`,
`bookings.block_reason`, `exceptions.charge_cents`, `exceptions.resolution`,
`profiles.pin_hash`, and `role`/`active` on update — are withheld from
`authenticated` entirely, and admins reach them through `SECURITY DEFINER` RPCs
that check `app.is_admin()` themselves. The cost: `select *` is refused on
`cars`, `bookings` and `exceptions`. Name the columns you need, which is the
house rule anyway.

**The eligibility gate is in the database, on the `booked → out` transition.**
`docs/01-DECISIONS.md` §11 calls it a hard block, so it is not a screen. It
applies to the admin too: the way past it is `admin_override_eligibility()`,
which records the override on the booking and raises it as an exception. Every
driver on the booking is checked, not only the main one — an additional driver
is free of charge but is still driving.

**Post-pickup car swap is allowed at the data layer, same category only.** §18
says an extension may involve swapping to a free car in the same category. The
guard permits `car_id` to change while a rental is `out` if the new car is in
the same category, and the exclusion constraint then decides whether the swap is
actually possible. How the flow presents that is Phase 3's problem; note that
the new car must be free for the *whole* rental, not just the extension, because
one booking row holds one car. If the business needs a mid-rental handover
recorded properly, that is a schema conversation, not a UI one.

**`my_cash_in_hand()` is today's cash only,** literally as §7 says, measured in
Athens time rather than UTC. Open question for the client: if a rep forgets to
hand over, yesterday's cash disappears from their screen. That may be the
intended pressure, or it may be a gap. Flagged, not decided.

**Rate limiting lives in Postgres.** Railway can run more than one instance, and
an in-memory counter would then be a suggestion. `app.rate_limit_hit()` is a
fixed-window counter; the limiter fails closed if it is unreachable.

**One device per rep is enforced at the app boundary,** not by revoking tokens.
Signing in on a new phone rebinds the device, and the next request from the old
one fails `rep_device_matches()` in `requireStaff()` and is signed out with a
reason. A true token revocation through the Supabase admin API would be
stronger; it is worth adding in Phase 5 hardening.

**Reps see only their own profile row.** §8 is silent on whether a rep may see a
covering colleague's name. Strict was chosen. If Phase 2's booking detail wants
to say "created by Maria" rather than showing nothing, that is a small policy
widening and an explicit decision, not a bug fix.

**`quote()` returns days, period and total — not the rate breakdown.** §6 shows
a day breakdown on the booking screen; the day *count* is the breakdown a rep
gets. Returning the extra-day rate would hand back a cell of the price table,
and rule 4 in `docs/03-SECURITY.md` says the rep receives one number.

## The test harness

The engine, RLS and isolation tests run against a **real Postgres 18**, started
in-process by `embedded-postgres`, with the Supabase pieces the migrations
assume (`auth.users`, `auth.uid()`, the `anon`/`authenticated`/`service_role`
roles) recreated by `tests/helpers/supabase-shim.sql`. The migrations run
unmodified — if one would fail on Supabase, it fails here first.

Identity switching mirrors PostgREST: `SET ROLE authenticated` with the claims
in `request.jwt.claims`. There is no service-role shortcut in the isolation
tests; a rep session does its worst against the same policies that will ship.

Each test file clones a migrated template database, so files are independent and
the racing-writes test gets two genuinely concurrent connections.

`npm test` runs everything. It needs no Docker and no network.

Two bugs the tests caught that review would probably not have:

- `greatest()` and `least()` ignore NULLs, so `availability()` reported a car
  with no bookings at all as occupied for the entire window.
- The gate cookie's HMAC key was memoised without regard to the secret, so a
  rotated `SESSION_SECRET` would have kept validating old cookies.

## Still blocked on the client

Unchanged from `HANDOFF.md`. Phase 1's back half and Phase 4 cannot finish
without them, and none of them have been invented:

1. The 8 category names and which of the 20 models sit in each
2. Model specs including tank size in litres
3. The 100-car fleet list — `scripts/import-fleet.ts` is ready for it
4. Price tables — at least one pricing period
5. The paper rental agreement and its terms, both languages
6. Hotel list and rep assignments
7. Company legal details for the contract and the privacy page
8. Domain, and a Google Play developer account

`supabase/seed/dev-seed.sql` carries clearly-marked placeholders so the engines
have something to run against. Every value in it is invented. It must not reach
production and none of its numbers should ever be quoted to the client.

## Not done, and where it belongs

- **Screens.** Phase 2 onward, per the build plan. Only a signed-in landing
  page and a settings page exist, so Phase 0's finish line can be checked.
- **Storage bucket and signed URLs for licence images.** Phase 3, with the
  pickup flow. The database half of that isolation test is written and passes
  (a rep cannot read another booking's driver row); the signed-URL half needs
  the bucket to exist.
- **WebAuthn / fingerprint unlock.** §21 offers "PIN or fingerprint". The PIN
  is built; the platform authenticator is a Phase 5 addition that changes no
  data model.
- **Retention purge job** for licence images. Phase 5, per the build plan. The
  `images_purged_at` column and the settings value are in place.
- **CI.** The isolation suite is meant to run on every change
  (`docs/05-BUILD-PLAN.md`, risks table). `npm test` is ready for it; the
  workflow itself is not written.
