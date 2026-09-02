# Implementation notes — Phases 0 to 6

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

**Phase 2** — the rep booking core (R2, R3, R6, R7) and the admin screens
A1–A5.

**Phase 3** — the pickup flow (R4), the return flow (R5), the exceptions queue
(A6, since replaced by incidents — docs/01-DECISIONS.md §34), R1's Today screen with cash in hand and hand-over, and end-to-end
verification of extensions with a same-category swap. 273 tests.

**Phase 4** — the private Storage bucket and signed URLs, licence capture with
Claude vision OCR, the photo per damage mark, the bilingual contract PDF,
on-screen signature capture with the emailed copy, and A10's contract half.
373 tests.

**Phase 6, the first real Supabase project** — provisioning, the 23
migrations applied unmodified, the security and performance advisors, the
generated types, the pilot's sign-in verified end to end, and the four
Supabase behaviours that had never been anything but assumptions. Two gaps
found and closed. 518 tests.

**Phase 5, the run-up to the October pilot** — A8 users and hotels, the licence
retention purge, A10's remaining half and the pick-up/drop-off times R3 never
collected, CI, A9 the audit-log viewer, push notifications with R8's
notification half, and the pre-pilot pass: a WCAG 2.1 AA audit and the load
test at 200 movements and a full fleet. 510 tests.

## Decisions taken while building — Phase 6

Everything in this repository had been written and tested against an embedded
Postgres 18 with a hand-written shim and had never run against a real Supabase
project. 510 tests proved the SQL was correct. They could not prove the
platform behaves the way the shim assumed, and in two places it does not.

**Both gaps are the same gap: the harness was more forgiving than the
platform.** That is the dangerous direction for a test to be wrong in — a
stricter harness produces a failing build, and a looser one produces a green
build and a broken deployment. Both are fixed in
`tests/helpers/supabase-shim.sql` as well as in a migration, and both new tests
were confirmed to fail with the migration removed. That is now the standard for
a shim change: if the harness cannot reproduce the platform's answer, fixing
the code is only half the work.

**`anon` could execute twenty-three of this schema's own RPCs**
(`20260830200000_privileges.sql`). Supabase's default privileges grant EXECUTE
on every new function in `public` to `anon` *explicitly*. Ten migrations after
0011 withdrew it with `revoke … from public`, which is the correct statement
against a bare Postgres and a no-op against an explicit role grant — revoking
from the PUBLIC pseudo-role does not remove a grant to the role `anon`. Twenty
of the twenty-three failed closed anyway on `app.assert_admin()`. Three did
not, because `app.assert_staff()` is deliberately silent when `auth.uid()` is
null so that the service role and our own triggers can call it, and that
allowance is load-bearing: `app.bookings_before_write()` reaches
`public.quote()` on every booking insert. Against the live REST API, holding
only the publishable key and no session at all, `staff_hotels()` returned every
hotel's name and area, and `booking_windows()` and `rental_days()` answered
too. The fix is at the grant and never at the assertion — tightening
`assert_staff()` would have closed those three and broken every trigger-side
caller with them — and it is paired with `alter default privileges` so that
migration 25 inherits the decision instead of re-inheriting the platform's.
The same class in schema `app`: Postgres's built-in EXECUTE-to-PUBLIC left
`authenticated` able to call all thirty functions in it, `app.rate_limit_sweep()`
and `app.log_security_event()` among them. Not reachable — PostgREST exposes
`public` only, verified with an `Accept-Profile: app` request that came back
406 — so it is recorded as defence in depth and fixed because
`20260830090100_extensions.sql` already claims it is true.

**`admin_list_users()` could not run at all** (`20260830210000_admin_list_users_email.sql`),
and this is the more serious of the two. `auth.users.email` is
`character varying(255)` on Supabase; the shim declared it `text`; 0018
declares `email text` in its RETURNS TABLE and hands back `u.email` unchanged.
plpgsql's RETURN QUERY checks the row type exactly, so the function raised
42804 on every call against a real database while
`tests/db/admin-users.test.ts` asserted the emails it returns and passed. A8 is
the only way the boss creates a rep, and `email` is the column that screen
exists to show him — `profiles` has no email column and no client role can
select from `auth.users`. The pilot's first act, creating the two reps the
October build is for, would have failed at the first page load. The fix is a
cast and nothing else.

**The advisors were run over the whole schema, and three findings are refused
rather than fixed.** `authenticated_security_definer_function_executable` fires
on twenty-eight functions and is describing the architecture in
"Column grants plus admin RPCs" above, not a defect: an admin holds the same
`authenticated` database role as a rep, so the privileged fields are withheld
from that role and reached only through SECURITY DEFINER RPCs that check
`app.is_admin()` themselves. All twenty-seven non-extension ones were confirmed
to assert internally — nineteen `assert_admin`, eight `assert_staff`, none
unguarded. `unused_index` fires on twenty-four indexes including
`no_double_booking` itself, on a database minutes old that has served no
queries; acting on it would drop the double-booking guarantee to satisfy a
statistic. `multiple_permissive_policies` describes the deliberate
`_select` plus `for all` `_admin_write` pairing on tables holding tens of rows.

Three are accepted with a reason. `extension_in_public` is true of
`btree_gist`, and moving it means touching the operator classes
`no_double_booking` rests on — a considered change with the isolation suite
run against it, not advisor housekeeping during provisioning. Its consequence
is the one loose end 0024 cannot reach: ~190 extension functions stay
executable by `anon`, owned by `supabase_admin` and so out of `postgres`'s
reach to revoke, and they are GiST support routines and crypto primitives with
no reach into a table. `unindexed_foreign_keys` fires on nine columns that are
parent-delete paths on tables whose parents are never deleted — and notably NOT
on `bookings(created_by)`, `bookings(hotel_id)` or `bookings(cash_handover_id)`,
the three the isolation predicate reads on every rep query, all of which are
already indexed. `auth_rls_initplan` is real and its `(select auth.uid())`
rewrite is semantics-preserving, but it rewrites `bookings_select` and
`bookings_update`, which are the isolation boundary; it wants its own change
with the isolation suite run against it, and the load test already has the
movements sheet at 39 ms for 200 rows.

One finding is left with a search_path that the repo's own rule says should
not be mutable: **six functions in `app` do not set it** — `rental_days`,
`today`, `touch_updated_at`, `audit_redact`, `window_from` and `window_to`.
Every SECURITY DEFINER function in the schema does set it, which is the claim
that mattered and it holds; these six are SECURITY INVOKER, their bodies
resolve nothing but `pg_catalog`, and each one reached from a definer inherits
that definer's `search_path = ''`. There is no live hijack path. It is still a
deviation from the rule and wants a one-line-each follow-up.

**The generated types replaced the hand-written ones, and every mismatch was a
discrepancy about the SCHEMA rather than about the data.** None of them meant
the app believed something false about a value. `src/lib/supabase/database.generated.ts`
is now produced by `supabase gen types` and never edited;
`src/lib/supabase/database.types.ts` is the thin layer over it holding the row
aliases and the three things the generator cannot express. First, a CHECK
constraint is invisible to it: `transmission`, `fuel_type`, `handovers.kind`,
`damage_marks.view` and `mark_type` are `text` with a CHECK rather than enums,
so it reports `string` where the app has a union — the database does enforce
them and the type system simply cannot see it. Making those five real enums
would delete that section outright and is worth doing, as its own migration.
Second, the generated `Insert` for `bookings` requires `ref` and `created_by`
because both are NOT NULL with no default, which is true of the table and wrong
about the grant: 0011 omits both and `app.bookings_before_write()` sets them,
so the app cannot send what the type demands and must not. Third, a parameter
with no DEFAULT is typed non-nullable, and several RPCs take a null that means
something — no home hotel, an incident closed with no charge, a block with no
reason typed, and the missing-licence-date failure §11 exists to catch. Where
the parameter has a default, `?? undefined` is right and is what is used; where
it has none, PostgREST resolves an RPC by the keys it is given and omitting one
finds no function at all, so the null has to go on the wire.
`src/lib/supabase/args.ts` is that cast, named once so the sites are greppable.

**A user who has ever written anything cannot be deleted, and the database is
what says so.** `audit_log.actor_id` references `public.profiles` with no ON
DELETE action, so GoTrue's `deleteUser()` comes back "Database error deleting
user" for any account with an audit row behind it. That is
`docs/04-SCREENS.md` A8's "deactivate, never delete" enforced rather than
trusted to the screen, and it is worth knowing before somebody meets it in
October and assumes something is broken. Deactivation was confirmed live on
the same account: `app.is_staff()` and `app.is_admin()` both return false for
it, which is `20260830150000_deactivation.sql` doing its job against a real
JWT rather than a simulated one.

## What the real project confirmed, and what it changed

The four behaviours listed under "Not done" as Supabase's own, each of which
had only ever been an assumption. Confirmed on a scratch fixture that was
deleted afterwards:

- **A signed URL expires on its TTL.** 200 immediately, 400 four seconds after
  a one-second TTL.
- **The storage service does consult the bucket policies.** A rep's session was
  issued a signed URL for a licence image on their own booking and refused one
  for another booking's — "Object not found", which is the right shape of
  refusal because it does not confirm the object exists. A direct download was
  refused identically. `tests/db/storage-isolation.test.ts` proves Postgres
  refuses; this is the half that proves the service asks.
- **`storage.remove()` destroys the object.** The row leaves
  `storage.objects`, the bucket listing empties, and a signed URL minted before
  the delete stops serving — eight trials at 400, one earlier reading of 200
  immediately after the call that could not be reproduced and is most plausibly
  a warmed CDN edge rather than the file surviving. The reason
  `src/lib/retention/purge.ts` deletes through the Storage API rather than with
  SQL was the right call, and it is now checked rather than reasoned about.
- **The bucket landed correctly**: private, 10 MB, the four MIME types, and all
  four object policies present with the expressions 0016 wrote.

**Public signup was open, and closing it is the most consequential setting
changed here.** A new project ships with `disable_signup: false`, so anyone
holding the publishable key — which reaches the browser by design — could
create an account. `app.handle_new_user()` gives it role `'rep'` and
`active` defaults to true, which means `app.is_staff()` returns TRUE for a
stranger, and `assert_staff()` is the whole of the guard on `quote()`,
`availability()`, `check_eligibility()` and `staff_hotels()`. A stranger could
therefore have called `quote()` across categories, dates and durations and
reconstructed the entire price table — which is exactly what
`docs/03-SECURITY.md` rule 4 exists to prevent, defeated not through the rep's
client but around it. Signup is now disabled; A8 mints accounts through the
GoTrue Admin API, which `disable_signup` does not affect, and that was verified
after the change. This is also the answer to why a rep with no `hotel_reps` row
being "inert" is a necessary property and not a sufficient one: inert against
the booking tables is not inert against the pricing engine.

**Settings changed, each deliberately:**

| Setting | Was | Now | Why |
|---|---|---|---|
| `disable_signup` | false | **true** | above |
| `mailer_otp_length` | 8 | **6** | the app validates `/^\d{6}$/` and the input is `maxLength={6}`; the boss would have received a code he could not type |
| `mailer_otp_exp` | 3600 | **900** | `docs/03-SECURITY.md` already says fifteen minutes for a reset link; an hour-long sign-in code is looser than the standard the file sets |
| `jwt_exp` | 3600 | **1800** | the deactivation window. `profiles.active` is authoritative in Postgres so a dismissed rep's live token can do nothing, but the token still exists until it expires and halving that costs nothing with refresh-token rotation on |
| `password_min_length` | 6 | **12** | nothing chooses a password today, and since §32 nothing types one either — the value GoTrue insists on for a rep account is generated junk nineteen characters long — but the floor is what any future password-shaped feature would inherit, and six is not it |

`site_url` is still `http://localhost:3000` and `uri_allow_list` is still
empty, deliberately: there is no domain (client item 8) and inventing one would
be worse than leaving it visibly provisional. Both must be set before the TWA
or any deployed URL exists.

**The admin cannot sign in yet, and it is not a code problem.** The magic-link
template has to carry `{{ .Token }}` for a six-digit code to reach the boss at
all, and the Management API refuses the change: *"Email template modification
is not available for free tier projects using the default email provider."* So
the template edit is blocked behind either a paid plan or custom SMTP — and
custom SMTP is client item 8, the same missing domain that has kept
`src/lib/email/mailer.ts` from ever sending. Compounding it, the built-in
sender is capped at two messages an hour and is documented as being for
testing, so even with a correct template the boss would get two sign-in
attempts an hour. **Reps are unaffected** — they sign in with a PIN the boss
hands them (§32) and need no mail — so the pilot is not blocked outright, but
the boss's own sign-in
is, and it resolves the moment SMTP credentials exist. That makes client item 8
a harder blocker than "the domain would be nice", and it should be said to the
client in those terms.

**Backups: there are none.** The project is on the Free plan, which has no PITR
and no restorable daily backup. For a pilot holding no real data that is
acceptable and it is a deliberate, recorded choice. It must not be the state on
1 March 2027: this database holds scanned driving licences of foreign tourists,
where a loss is worse than a breach is reportable. Upgrading to a plan with
PITR is a hard pre-production item, not a nice-to-have.

## Decisions taken while building — Phase 5

**Creating a rep is a new category of service-role use, and it is the only
door.** Everywhere else the key does something the server does on its own
behalf — rate limiting, the security log, device binding, PIN storage, the
retention job. `createRepAccount()` acts because the boss asked it to, which is
the pattern `src/lib/supabase/admin.ts` warns against. It is nevertheless the
only available surface: an insert into `auth.users` is 42501 for
`authenticated` **and** for `service_role` (probed, not assumed), and PostgREST
does not expose the `auth` schema, so there is no policy, grant or SECURITY
DEFINER function that could stand in for the GoTrue Admin API. Three things
keep it from being a hole. The authorisation is still Postgres's — the caller's
own session has to get an answer out of `admin_list_users()`, which asserts
`app.is_admin()`, before the Admin API is touched. What the key can mint is
inert: `app.handle_new_user()` forces role `'rep'`, and a rep with no
`hotel_reps` row can read nothing but their own profile, so promotion still
needs `admin_set_user_role()` and its IR113 self-check. And every account event
is logged with the address hashed and never the password.

**A credential handed over rather than an invite link, and the loser is named.**
Supabase offers both shapes, and `inviteUserByEmail()` needs email delivery —
client item 8, the same missing domain and SMTP account that has kept
`src/lib/email/mailer.ts` from ever sending anything. Supabase's built-in sender
exists but is rate limited to a couple of messages an hour and documented as
being for testing. An invite that does not arrive is a rep who cannot sign in,
at a hotel desk, during the fortnight the whole October date exists for. So the
credential is generated server-side from `crypto.randomInt`, shown once,
recoverable never, with a re-issue action for when it is lost, and
`email_confirm` set so the account works immediately rather than waiting on a
mail that cannot be sent.

**Since §32 that credential is a six-digit PIN, not a password.** The rep has
one credential and it is the one they were already typing every morning; the
password GoTrue still requires is generated junk that is never returned, logged
or displayed, and re-issuing a PIN rotates it so an old, real password from
before §32 cannot outlive the re-issue. The cost, stated in the file rather than
left implicit: the boss knows the initial PIN, and 0027 removed rep-side
self-service at his own ask, so it stays known until he re-issues. He is the
owner, he already has admin rights over every row, and the audit log records the
actor — but it is real, and the answer to a PIN somebody else has seen is the
same instant re-issue as the answer to a lost one. When the domain arrives, the
invite becomes a choice rather than the only door.

**A8 is the isolation boundary, so its headline test is withdrawal and not
grant.** `hotel_reps` is what `app.my_hotel_ids()` reads and that is the whole
of the §8 cover-shift rule, so every row that screen writes re-shapes who can
see whose bookings. A permission that cannot be taken away is not a permission,
so the test that matters proves visibility appears when a hotel is assigned and
disappears when it is removed, in both directions. Moving a rep's home hotel is
one RPC doing both halves in one transaction: there is no instant in which they
are stationed at both hotels or at neither, and `admin_set_cover(false)` cannot
be the click that unstations somebody.

**Deactivating an account did not deactivate it, and that is the most serious
thing this phase found.** `admin_set_user_active()` sets `profiles.active =
false` and the app boundary honours it, but `bookings_select` and
`bookings_update` read `created_by = auth.uid() or hotel_id = any
(app.my_hotel_ids())` and neither branch asked whether the caller was still
staff. A JWT issued before the deactivation stays valid until it expires and
Supabase cannot be told otherwise, so for the life of that token a dismissed
rep with the anon key and their own access token could go at PostgREST
directly and read their own bookings *and every booking at the hotel they used
to cover* — another rep's guests — along with those bookings' drivers,
`licence_number` included, their handovers, damage marks, contracts,
incidents, and the licence images in the private bucket, every one of which is
gated on `app.can_read_booking()`. And they could **UPDATE a live booking**:
verified, not theorised, the statement returned `rows=1`. A dismissed rep
changing a guest's dates, room or status is the worst item on that list and is
precisely the caller `docs/03-SECURITY.md` names. INSERT was already safe,
because `app.bookings_before_write()` reaches `quote()`, which asserts staff.

The fix introduces no new mechanism: `app.is_staff()` already means "signed in,
and still active", `app.is_admin()` already checks `active` itself, and putting
the predicate inside `app.can_read_booking()` closes every child table at once
— which is the payoff for the rule having been written in one place. No
GoTrue-side ban was added alongside it: it would block a fresh sign-in but not
an already-issued token, and a second switch that could drift out of step with
`profiles.active` would make "is this person still staff" a question with two
answers.

**The purge's predicate is positive, and never a negation.** It runs as the
service role and bypasses RLS entirely, so the predicate is the only thing
between a correct sweep and deleting a contract. An object is due only if a
booking row **exists**, its `end_date` is older than the window, and the object
sits under `<booking>/licences/`. Nothing is deleted because the sweep failed
to find a reason to keep it. An object whose booking has vanished is an
**orphan**: counted, reported on A10, never swept — a negation over a join is
the shape that deletes the world the day the join breaks. `end_date` is the
date the rental was contracted to end; it is a `date` and not an instant, it
never moves backwards (IR110), and an extension moves it forward, which
correctly pushes the purge later.

**The deletion moved out of SQL, and that is a correction to what this document
previously said.** The sweep was written down here as `delete from
storage.objects where …`. That is the right predicate and the wrong verb: on
Supabase that table is the metadata in front of the bucket's backing store, so
deleting a row removes the app's knowledge of the file and leaves the file
itself in the bucket. A purge that records destroying a scanned driving licence
while the object survives is worse than no purge — it is a GDPR obligation
marked done. The database hands over the list and `src/lib/retention/purge.ts`
deletes through the Storage API, which owns both halves. Two independent layers
decide what may go, sharing no code: the SQL returns only objects whose second
path segment is `licences`, read through the same `app.object_file_kind()` the
bucket policies use, and every path is then re-parsed in TypeScript with
anything that is not `<booking>/licences/<file>`, or that names a different
booking from the one the query reported, dropped rather than deleted. Malformed
names are skipped rather than fatal — a bare `::uuid` cast in the join would
raise 22P02 on one bad row and abandon the whole unattended run.

**A10's window half turned out not to be a settings screen.** `pickup_at` and
`dropoff_at` have existed since Phase 1 and are read in six places — R1's Today
screen sorts by them, A1's movements sheet sorts and prints them, the contract
prints them — and **R3 never collected either**, so every booking ever made
carried null and the boss's morning screen sorted a column of blanks.
`docs/04-SCREENS.md` R3 step 1 asked for both, with the windows as their
defaults. Building the setting without the field it feeds would have been a
knob attached to nothing. Postgres does the date-plus-time conversion, from a
literal naming `Europe/Athens`, rather than a `Date` in whatever zone the
container runs in — which would get the March and October changeovers wrong in
a country that observes both.

**`window_override` was the client's opinion.** It sits in the rep's own INSERT
and UPDATE grant, so a rep could book an 03:00 pick-up marked ordinary, or
stamp an override on a routine one; §5 says the override is *recorded*, and a
recorded fact the caller supplies is claimed, not recorded. Same family as
`contracts.signed_at` in 0017. The database derives it now, for the admin too.
It lives in its own BEFORE trigger rather than inside
`app.bookings_before_write()`: that function is 200 lines of load-bearing
transition rules and has already been re-pasted whole once, and pasting it
again to add two lines is how a silent divergence starts. Postgres fires
row-level BEFORE triggers in name order, so `bookings_guard` still has the last
word on every field it protects.

**A9 joins the actor's name and nothing else, ever.** `app.audit_redact()`
strips `pin_hash`, `licence_number`, the two licence image paths, `pdf_path`,
`signature_path` and `photo_path` on the way in, because the log records who
did what and not a second index of where the personal data sits. There are
tests asserting each of those is absent, searched across the whole serialised
entry rather than the field it would sit in. An audit screen that quietly
re-assembled what the redaction removed would be the last place anybody thought
to look for a leak. The screen shows the *difference* between `before` and
`after` rather than two forty-column rows, values are truncated at 160
characters because one edit to `app_settings.company` would otherwise print the
entire bilingual contract terms twice, and paging is limit+1 rather than a
count over a table that only ever grows.

**Incident notifications are swept, not pushed from where they are raised.**
Three code paths raised one when this was written; §34 left exactly one, a rep
sending a report from `/incidents`. The sweep is kept anyway, for the reason it
was built: hanging a send off the raising code means the second path added next
year notifies nobody. `incidents.notified_at` is the stamp; it is in no client
grant, so a rep cannot mark the boss's inbox as read, and it is written only
after the send so a failure leaves them pending. They are stamped even when
nobody is subscribed, or the first person to enable push would be greeted by
every incident in the history of the business.

**A rep's notification lists movements and never counts them.** §7 allows a rep
exactly one aggregate and Phase 3 already declined to put a count of today's
pickups on R1, on the grounds that a count of rentals starting today is a
figure company revenue can be worked back from. "You have 4 pickups today"
would put back precisely what that decision left out. The summary prints times,
plates and guests, and when there are more than fit it ends in an ellipsis
rather than "and 3 more" — which would be the same number by another route.
`rep_day_movements()` returns rows, and a test asserts the columns it is
*declared* to return, so a future widening that added a total fails in CI
rather than on a phone.

**The service worker is registered from a bundled component, never an inline
script.** `src/proxy.ts` sets `script-src` to nonce + `strict-dynamic` with no
`unsafe-eval` in production, so an inline registration would need the nonce
threaded to it by hand and would work in `next dev` while failing silently on
Railway. `worker-src 'self' blob:` already permitted the worker itself.
`/sw.js` also joins the proxy's matcher exclusions, for a reason of its own: a
browser re-fetches a service worker on its own schedule, including while a
rep's device is PIN-locked, and the proxy would answer that with a redirect to
`/unlock` — and a worker that fails to update runs the version it has for ever.
The worker does not cache and does not intercept fetches: §23 says online only,
so a cache would be an offline mode nobody asked for, and the first thing it
would do wrong is show a rep a stale availability screen.

**Every word in a notification is translated by the sender.** The worker is
outside `next-intl`'s reach entirely — no React, no provider, no request locale
— so it would have been the one place a hard-coded English string could hide.
The sender reads the same two catalogues, picks the one matching that person's
`profiles.lang`, and puts finished text in the payload. It goes through
next-intl's own `createTranslator` rather than a `{placeholder}` replace,
because "3 new exceptions" is a plural and Greek's plural rules are not
English's; a private formatter would have printed the raw ICU source the first
time somebody wrote a correct message.

## The pre-pilot pass

**The load test measured, and prints what it measured.** Availability over the
whole fleet is 6 ms for a fortnight and 7 ms for the 365-day maximum the engine
permits; the movements sheet is 39 ms for 200 rows plus 12 ms for the four id
lookups it hangs off them; cash in hand is 4 ms. Budgets are set at 1–5 seconds
because they exist to catch a collapse — a missing index, an accidental cross
join — not to police milliseconds on a laptop.

One thing the exercise established that the plan had not: **200 movements on
one day is not reachable with a hundred-car fleet.** A day is inclusive and the
exclusion constraint gives one car at most one hold on a date, so a car
returning on the 15th and a car collected on the 15th are necessarily different
cars. The fixture loads twice the real fleet to produce the row count the build
plan asks the sheet to be tested at, which makes every budget conservative.

**The WCAG audit found two real defects.** Every input and every quiet button
drew its border in `--color-line`, which is 1.39:1 against the field's own
white and 1.29:1 against the page — nowhere near §1.4.11's 3:1 for the visual
information that identifies a control, and a field here is white on a
near-white page, so that border is the only thing saying where the control is.
`--color-control` now draws every control edge; `--color-line` stays for card
edges and dividers, which carry no information and which 1.4.11 does not cover.
And the damage diagram's view switcher declared `role="tablist"` without a
roving tabindex or arrow keys — a role that promises a screen-reader user
"tab, 2 of 5" and then does not move when they press Right, while putting four
needless stops in the tab order. Both are fixed.

The contrast checks are now a test that computes ratios from the tokens *and*
parses the ratio each token claims in its own comment, so a stale comment fails
CI. That found a third thing: four of the seven annotations were wrong, every
one of them understating the real ratio. The structural checks came back clean
— no image without alt, no positive tabindex, no removed focus ring, no
unlabelled control, no skipped heading level, `lang` on `<html>`, a skip link,
and `prefers-reduced-motion` honoured.

## Getting the pilot signed in

Done, and verified end to end against the real project rather than reasoned
about. The order below is what was actually run, and it is the order to repeat
on any future project:

1. `.env.local` holds the project URL, the publishable key, the service-role
   key, a real `SESSION_SECRET` and a `DATABASE_URL`. Two notes on that last
   one: the direct host (`db.<ref>.supabase.co`) is IPv6-only and unreachable
   from an IPv4-only machine, so it is the **session pooler** on port 5432 —
   not the transaction pooler, which will not take this DDL; and the pooler
   presents Supabase's own CA, so `sslmode=no-verify` is what connects. It is
   used by `npm run db:reset` and by nothing at runtime.
2. `npm run db:reset` applies every migration in filename order in one
   transaction. All of them applied unmodified, first attempt, including the
   `auth.users` trigger and the `storage.objects` policies. **Not** `--seed`:
   `supabase/seed/dev-seed.sql` is invented throughout and this project is the
   pilot's.
3. **The first admin is made by hand**, because `app.handle_new_user()` starts
   everybody at `'rep'` and A8 refuses a caller who is not already an admin.
   Create the account through the GoTrue Admin API with `email_confirm: true`
   — there is no SMTP, so a confirmation mail would never arrive — and then
   `update public.profiles set role = 'admin' where id = …`. Every rep after
   that is created on A8.
4. `{{ .Token }}` in the magic-link template. **Still outstanding, and
   blocked** — see "What the real project confirmed" above: the Management API
   refuses template edits on the Free plan with the default email provider, so
   this waits on custom SMTP (client item 8) or a paid plan. Until then the
   boss cannot complete a sign-in; reps can, because they use a PIN (§32).

Confirmed working on the real project, in this order: the trigger fires and
writes a profile at role `rep` with the name and language out of the user
metadata; promotion to admin by hand; a real sign-in with
`signInWithPassword`; that session calling `admin_list_users()` through
PostgREST, which is A8's page load; `createRepAccount()` minting a rep with a
real temporary password; that rep signing in with it; and the new account
proving inert — role `rep`, seeing nothing but its own profile row, and IR001
from any admin RPC. **That walk-through predates §32**: the same sequence today
mints a PIN rather than a password and the rep signs in with that, through the
`credential_lookup_for_email()` + `mintSessionForEmail()` path. It has not been
re-run end to end against the real project since the change; the DB half is
covered by `tests/db/server-api.test.ts` and the walk-through is worth repeating
when the project is next reachable. The rest of what it proved — the trigger,
the promotion, A8's page load, the account being inert — is untouched by §32.
The accounts and the scratch fixture were deleted afterwards.

Two things worth knowing before they surprise somebody. `auth.users` INSERT is
refused with 42501 for `service_role` as well as for `authenticated`, so the
assumption A8's whole design rests on holds on a real project and the GoTrue
Admin API really is the only door — the note in `src/lib/users/accounts.ts` is
accurate as written. And GoTrue's own signup endpoint validates the address:
`@example.invalid` and `@example.com` are both rejected, which is why the
scratch accounts had to be created through the Admin API, and which is a
useful thing to know when writing a test.

## Decisions taken while building — Phase 4

**The path is the authorisation key, and that is the whole design of the
bucket.** One private bucket, `booking-files`, and every object in it is named
`<booking_id>/<kind>/<filename>` with `kind` one of `licences`, `damage`,
`signature`, `contract`. `storage.foldername()` gives segment 1 as the booking
and segment 2 as the kind, so the object policies hand segment 1 straight to
`app.can_read_booking()` — the same function the bookings, drivers, handovers
and damage-marks policies already use. A file cannot be reachable by anyone who
could not already read the row that points at it, and there is no second copy
of the rule to drift out of step with the first. A malformed name is a
*refusal*, not an error: `app.object_booking_id()` returns null rather than
raising, because an exception inside a policy surfaces as a 500 and tells the
caller their guess got as far as the cast.

The kind folder does two more jobs, and both are the reason it exists rather
than a naming convention inside one folder. **Retention:** every licence image
sits under `<booking>/licences/` and nothing else does, so Phase 5's purge job
can enumerate exactly what §25 says to delete without parsing filenames — a
purge that has to read a filename to decide what to keep is a purge that will
one day delete a contract. **Immutability:** `contracts` is granted SELECT and
INSERT and nothing else, and the update/delete object policies match it. A rep
may replace a licence or damage photo (a re-take, a mis-shot); nobody holding a
session, admin included, can overwrite or delete a signature or a contract PDF.
Only the service role reaches past that, which is what the retention job runs
as.

**Retention does not depend on `booking_drivers.front_image_path`, and there is
a test that says so.** `booking_drivers` is granted to `authenticated` at table
level, so a rep can clear their own driver's image pointer. That could have
been a way to make a scanned licence outlive its window — an orphaned object
nothing points at, which a column-driven sweep would never find. It is not,
because the sweep reads the bucket layout instead. This was the alternative to
a new migration narrowing that grant, and it is the better one: the guarantee
lives in how the files are laid out rather than in a column a future feature
might legitimately want to write.

**The storage shim, rather than untested storage policies.**
`tests/helpers/supabase-shim.sql` created only the `auth` schema, so the bucket
policies would have shipped with no test at all — and
`docs/05-BUILD-PLAN.md`'s required list names "a rep's signed URL for their own
licence image does not grant another booking's image" as a test that must
exist. The shim now recreates `storage.buckets`, `storage.objects` and
`storage.foldername()` (whose "every segment but the last" behaviour the whole
path convention rests on), so those policies run under the same real Postgres
as every other policy in this repo. What is under test is the authorisation
decision Postgres makes when the storage service asks it — which is the
decision behind both an upload and a signed URL, since the service will not
mint a URL for an object the caller's SELECT policy refuses.

**What that test does NOT cover, stated plainly:** the HTTP half. That a minted
URL actually expires after its TTL, and that the Supabase storage service
consults these policies at all, is Supabase's own behaviour. It is not
simulated here and should be confirmed once against a real project before the
October pilot.

**OCR never blocks a pickup, and the way to mean that is to have no code path
where a bad read stops the flow.** No API key, a rate limit, a timeout, a
refusal, an unparseable answer, a photograph of a hotel breakfast — every one
returns the same shape: the photos stored, an empty pre-fill, and a line
telling the rep to type it in. `ANTHROPIC_API_KEY` is read through its own
accessor rather than `serverEnv()` for the same reason: it is the one server
secret the app is expected to run *without*, and a deployment with no key must
still be able to take a pickup.

**OCR never overwrites a value a human has saved.** This is the delicate half
of §10 and it lives in `src/lib/ocr/merge.ts`, pure and tested on its own.
`booking_drivers.ocr_reviewed` is what "a human has saved this row" means —
`saveDriver()` sets it true. So an unreviewed row is a previous read that a new
read may replace; a reviewed one only ever has its still-empty fields filled,
and never its name or date of birth. The case that decides the rule is a rep
who typed a name off an unreadable card and then took a better photo: their
work is not overwritten by a worse read. With no row at all, the booking's own
guest details fill what the card did not give up — and if there is still no
name and no date of birth, *nothing is written*, because inventing a
placeholder to hold a photo would put a fictitious driver on a rental
agreement.

**Order inside `captureLicence()` is deliberate.** The read runs on the bytes
in memory *before* the upload, so a photograph of the wrong thing costs one
call and not a stored file. The photos are then stored whether or not the read
worked, because §9 wants front and back on file as a record in their own right.
The driver row is written before the images, because the driver's id is the
filename — so a re-take replaces the shot it corrects instead of accumulating
orphans.

**The OCR boundary is treated as hostile, because the image comes from a member
of the public holding a card.** The prompt is fixed at module scope and nothing
from the request varies it; the image is the only variable input; the answer is
parsed into a strict Zod schema and re-parsed on our side of the SDK, so
anything outside it is discarded; and the prompt says out loud that text in the
photograph is data to transcribe and never an instruction to follow. A card
printed with "ignore previous instructions" yields a `last_name` of exactly
that, which the rep corrects like any other misread — there is no field in the
schema through which it could reach anything else. Two per-user rate limits cap
the spend: a burst one for a stuck retry loop, a daily one for the bill.

**Confidence is shown, and changes nothing.** Three coarse bands plus the
number, because 0.62 read off a phone in sunlight means nothing to anybody. A
low score and a high score leave the same editable form underneath. It is a
prompt to check, never a gate.

**The font was the whole PDF problem.** The base-14 PDF fonts have no Greek
glyph coverage whatsoever, and the contract is Greek by decision (§16, §24). It
also cannot be fetched: `src/proxy.ts` sets `font-src 'self'`, which blocks a
CDN font outright, and `script-src` is nonce + `strict-dynamic` with no
`unsafe-eval` in production — so any approach that pulled a font or eval'd a
template in the browser would have worked in `next dev` and failed silently on
Railway. Both halves are avoided by not being in a browser: Noto Sans
Latin/Greek/Cyrillic (SIL OFL, licence committed beside it in `assets/fonts/`)
is read off disk and subsetted into the file by `@react-pdf/renderer`, which is
declared in `serverExternalPackages` so a stray client import cannot drag it
into a browser chunk. A test pulls the embedded font name back out of the
rendered bytes, because "it rendered" and "the Greek is really in there" are
different claims.

**The contract is the one surface that does not switch languages.** §16 and §24
put Greek and English on the same document, always, so `next-intl`'s
per-request locale is the wrong instrument — the renderer needs both at once.
`src/lib/contract/labels.ts` reads `messages/el.json` and `messages/en.json`
directly and prints every label as "Ελληνικά / English". They are still the
catalogues, still held to exact parity by
`tests/unit/messages-parity.test.ts`, and nothing is hard-coded. A missing key
renders as `[path]` and a test fails on it, so a label present in one catalogue
and not the other cannot reach a contract.

**The car diagram is data now, because two renderers draw it.**
`src/lib/damage/shapes.ts` holds the five outlines; React DOM draws them on the
screen and `@react-pdf`'s SVG primitives draw them in the file. Same reasoning
as `zones.ts`: the marks are relative 0–1 coordinates inside one viewBox, so
two diverging boxes would move a mark recorded at the desk to a different place
on the agreement the guest signed. The pins use the rep's exact coordinates,
not the zone centre, and share their numbering with the list beneath.

**A10's contract half was built here, and only that half.**
`app_settings.company` had existed since Phase 1 with nothing in `src/` reading
or writing it, and the PDF has no source for its own letterhead or its own
terms without it — a PDF with nowhere to get a letterhead from is a PDF with an
invented letterhead. The retention window and the default pick-up/drop-off
windows change nothing about a document a guest signs and stay in Phase 5 with
the rest of A10.

**The signature has two equal paths, not a path and a fallback.** Drawing on a
canvas is inherently pointer-only: there is no keyboard gesture for a
signature, and a "type your name to sign" box would quietly change what the
guest is agreeing to. So the second path is the one the business already has —
the guest signs a paper copy and the rep photographs it with a plain file input
— and it produces the same stored image and the same contract.
`docs/02-ARCHITECTURE.md` asks the signature flow for an accessible non-visual
path; this is a real one rather than a gesture at one. Same reasoning as the
damage photo, where a bare `<input type="file" accept="image/*" capture>` opens
the camera on an Android phone and falls back to the system file picker
everywhere else.

**The agreement and the copy are steps, not gates.** Nothing in the database
requires a signed contract to reach `out` — §11 makes eligibility the hard
block and nothing else — and inventing a second one here would be a rule the
client never agreed to, on top of being unworkable while the terms are
outstanding. The confirm step says whether an agreement is on file so the rep
can see what they are about to do. R4's order is now
`docs/04-SCREENS.md`'s own: licence → eligibility → fuel → damage → agreement →
copy → payment → confirm.

**Three gaps closed rather than built around**, all probed against the running
schema first, in `supabase/migrations/20260830130000_contract_signing.sql`:

- **Nobody could record that a copy was emailed.** `contracts.emailed_to` and
  `.emailed_at` have existed since Phase 1, and `0011_rls.sql` grants `select,
  insert` on `contracts` and nothing else — so an UPDATE was 42501 for a rep
  *and* for the admin. §16's optional email delivery happens after the row
  exists, so those two columns were unreachable by any caller. They now have a
  grant two columns wide and a policy scoped to the booking's own read rule.
- **A rep could back-date a signature.** `signed_at` defaulted to `now()` but
  was accepted from the client, as was `version`: a rep inserted a contract
  stamped 2001-01-01 at version 99 and the database took it. When a document
  was signed is a fact about the write, not a client's opinion, and it is
  exactly the fact a dispute turns on. `app.contracts_before_write()` sets both
  — for the admin too — and on UPDATE restores every column but the two above,
  so a future widening of that grant cannot re-point a signed agreement at
  another file or re-attribute it to another signer.
- **Neither `contracts` nor `damage_marks` was audit-logged**, against
  HANDOFF.md's "every write is audit-logged". Both were missed from the trigger
  list in `0010_guards.sql`, and they are the two things most likely to be
  argued about later. Added, with `pdf_path`, `signature_path` and `photo_path`
  joining the licence image paths in `app.audit_redact()`: the log records who
  signed what and when, not a second index of where the personal data sits.

**`vitest.config.ts` gained two aliases.** `@` so a test can import a module
without rewriting its imports, and a stub for `server-only`, whose whole job is
to throw outside a server component and which would otherwise have put the PDF
renderer and the storage helpers permanently out of reach of a test. The real
package still guards the app; only vitest sees the stub.

## What is placeholder, and what is not

Nothing in this phase invents a value the client owes us. Specifically:

- **`app_settings.company` starts empty and stays empty.** No migration and no
  seed puts anything in it, and there is a test asserting a fresh database
  leaves it `{}`. There is no invented ΑΦΜ, no invented registered name and no
  drafted set of Greek rental terms anywhere in the repository.
- **The placeholder is therefore the SCREEN, not the data.** A10 lists exactly
  which of the seven required fields are missing and says contracts cannot be
  signed until they are filled in. The boss pastes the real terms into two
  textareas and they print verbatim — the app does not reword, shorten or
  translate a legal document on its way to a guest's signature.
- **An unfilled settings row cannot become a signed agreement.**
  `contractReadiness()` gates the signing action, which refuses with
  `companyMissing`. The preview still renders, so the layout can be checked,
  and it carries a DRAFT stamp in both languages saying it has no legal effect
  and must not be signed. That is the whole of "do not let a placeholder reach
  anything that looks like a real signed agreement".
- **Email delivery is complete machinery with no credentials.** There is no
  domain yet (client item 8), so `send()` returns `not_configured`, the address
  the guest gave is recorded against the contract and the booking, `emailed_at`
  stays null, and the screen says plainly that no copy has gone out. Setting
  the four `SMTP_*` variables starts delivery with no code change.
- `supabase/seed/dev-seed.sql` is unchanged and remains invented throughout. It
  must not reach production.

## Decisions taken while building — Phase 3

**The pickup and return flows keep no wizard state in the browser.**
`docs/04-SCREENS.md` asks for R4 to be "resumable if the app is closed". Each
step writes its own rows — drivers, the handover, its damage marks, the payment
fields — and which step you land on is read back off those rows on every
request. A phone that locks mid-pickup with a guest waiting reopens where it
was, on any device, and there is no half-finished draft to reconcile.

**The eligibility gate is a screen over a database rule, and adds no rule of
its own.** `app.assert_drivers_eligible()` sits on `booked → out`, so the
confirm action sends the transition and reports what Postgres said. The gate
screen shows the same `check_eligibility()` answer in advance so the rep learns
which rule failed before they have taken a licence out of a guest's hand — but
it is a display, not the control. "Request admin override" is honest about
being a message rather than a button: `admin_override_eligibility()` is
admin-only and is reached from A5, and there is no admin override UI in this
phase.

**Exception `detail` is numbers and codes, never a sentence.** It is written
once by whichever flow raised it and read later by a manager who may be working
in either language, so an English sentence stored there would be a hard-coded
user-facing string with a long fuse. `fuel_short` stores `8/8 → 6/8 (−2/8 ≈ 9.5
L)`; `new_damage` stores `2: left/scratch, front/dent`. A6's item page renders
the underlying readings and marks with translated labels and shows the stored
line beside them as the compact evidence.

**Both R5 flags are raised at confirm, before the status update.** Raising them
as the rep works would fill the boss's inbox with contradictions every time
someone re-read a fuel gauge. Ordering them before the transition means the
evidence survives a failed transition; an existence check per type, rather than
the transition itself, is what makes them happen only once.

**A rep may not price a fuel shortfall or new damage, and the screens say so
rather than leaving it to training.** §14 is a rule about what a rep does in
front of a guest, so it is written on the damage step and again on the confirm
step, not only enforced by the absent column grant.

**One new aggregate reached a rep screen, and it is the permitted one.** R1
carries today's own cash in hand and nothing else that sums, counts or
averages. There is deliberately no count of the day's pickups: a count of
rentals starting today is a figure company revenue can be worked back from,
which is the test HANDOFF.md asks to apply before any number goes on a rep
screen.

**The car diagram is keyboard-first, not keyboard-retrofitted.** Marks are real
buttons in tab order with their own labels; every mark also appears in an
ordered list in words; and a mark can be ADDED from the form alone by choosing
one of nine named zones, so placing damage never requires pointing at a pixel.
The SVG is `aria-hidden`. `src/lib/damage/zones.ts` holds the single
zone ↔ coordinate mapping, so the pins and their text alternative cannot drift
apart, and a unit test round-trips it.

**`my_hand_over_cash()` — a gap closed, not built around.** `my_cash_in_hand()`
counts cash `where b.cash_handover_id is null`, so handing over needs two
writes that agree: a `cash_handovers` row and that row's id stamped on the
bookings it covers. A rep could do the first and not the second —
`cash_handover_id` is absent from their UPDATE grant and the guard reverted it
for a non-admin — so a "Hand over" button on the existing schema would have
recorded a receipt and left the rep's figure unchanged for ever. Verified
against the running schema before anything was written.
`supabase/migrations/20260830110000_cash_handover.sql` fixes it the same way
`staff_hotels()` did: a SECURITY DEFINER function that takes **no arguments**
and reads both the amount and the booking set from the same predicate
`my_cash_in_hand()` reports on, so the button and the figure above it cannot
disagree. The guard trigger gains exactly one carve-out — a non-admin may move
`cash_handover_id` from null to a `cash_handovers` row that is their own, once.
Clearing it, re-pointing it or claiming another rep's is reverted, and the
column grant still refuses any direct client write, so the RPC remains the only
door. New error code: `IR114`, nothing to hand over.

**1 Sep 2026 — superseded in part.** This RPC still does exactly the two writes
described above and nothing changes about it here. What changed is which
predicate `my_cash_in_hand()` reports on: the owner's ask (docs/01-DECISIONS.md
§31) was that only HIS confirmation should clear a rep's figure, and until this
point `admin_confirm_cash_handover()` stamped `confirmed_by` for
record-keeping while `my_cash_in_hand()` never looked at it — so a rep's own
tap above cleared their own figure in full, and the boss's confirmation
gated nothing. `supabase/migrations/20260901093000_cash_confirmation.sql`
makes a booking leave the figure only once its handover is confirmed, adds
`my_cash_ready_to_hand_over()` so R1 can tell "still sitting with me" apart
from "handed over, awaiting the boss" without a second look at
`my_cash_in_hand()`, and adds the admin screen (A12 · Cash) that was simply
missing before — `admin_confirm_cash_handover()` had no caller anywhere in the
app.

**Open question for the client, unchanged and now visible on a screen:** if a
rep forgets to hand over, yesterday's cash disappears from R1's strip, because
§7 says "today's". That may be the intended pressure or it may be a gap. Still
flagged, still not decided.

**R7's swap candidates were wrong, and are fixed.** The data-layer guard was
correct; the screen disagreed with it. `checkExtension()` loaded availability
from the current end date and offered any same-category car free over the added
days — but a swap moves the whole rental onto the new plate, so the exclusion
constraint judges the entire range. A car busy inside the original rental dates
was being offered and then refused with `23P01` at the moment the rep
confirmed. Availability is now loaded over the whole rental, and the choice
moved into two pure functions in `src/lib/availability/types.ts` so the rule is
unit-testable without a database. The rental's start date and car are now read
from the booking row rather than taken from the form.

**A rep can still insert a `cash_handovers` row directly**, with their own
`rep_id` and any amount, because the grant and policy from Phase 1 allow it.
That row affects no figure — only `my_hand_over_cash()` stamps bookings — and
`admin_confirm_cash_handover()` means every receipt is a claim the boss
confirms rather than a fact. Left as it is; worth revisiting in Phase 5
hardening alongside `handovers.by_profile`, which a rep can likewise set to
another profile on a booking they can already reach.

## Decisions taken while building — Phases 0 and 1

**i18n without locale routing.** `next-intl` resolves the language from a cookie
seeded from `profiles.lang`, not from a `/el` or `/en` URL prefix. This is an
internal app behind a login with `robots: noindex`, so the crawlability argument
for locale routing does not apply, and a TWA start URL with a language baked
into it would be wrong for a bilingual staff. If a public page is ever added,
that page — and only that page — should get proper locale routing.

**Column grants plus admin RPCs, rather than admin-only tables.** An admin holds
the same `authenticated` database role as a rep, so a column grant cannot tell
them apart. The fields a rep must never receive — `cars.notes`,
`bookings.block_reason`, `exceptions.charge`, `exceptions.resolution`,
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

Unchanged from `HANDOFF.md`, and none of them have been invented. Items 5 and 7
are what stop Phase 4 finishing: the machinery is built and driven from
`app_settings`, but until the boss pastes the real terms and legal details in,
every contract the app produces is stamped DRAFT and cannot be signed. That is
the expected state, not a defect — see "What is placeholder, and what is not".

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

Item 6 is the one that changed shape this phase. The hotel list and rep
assignments are still outstanding, but they are no longer blocking: A8 is the
screen the boss enters them on himself, which was the point of building it
first.

## Not done, and where it belongs

- **A7 reports and CSV export.** The only screen in the inventory still
  unbuilt. `docs/05-BUILD-PLAN.md` defers it until genuine data has
  accumulated, and the October pilot is what produces that data — building
  revenue-by-rep against a placeholder fleet would be building a chart of
  invented numbers. It stays after the pilot deliberately.
- **Core Web Vitals on a real mid-range Android on 4G.** Asked for by the build
  plan and NOT done: it needs a deployed URL and a physical device, and there
  is neither a domain nor a Supabase project (client item 8). A lab figure off
  a laptop would mean nothing and is not offered in its place. The data layer
  IS measured, at full volume, in `tests/db/load.test.ts`.
- ~~**The signed-URL HTTP layer.**~~ DONE in Phase 6, against the real
  project: a URL expires on its TTL, and the storage service does consult the
  policies — a rep was refused a signed URL for another booking's licence
  image, and refused the direct download too. See "What the real project
  confirmed".
- ~~**The purge against real Storage.**~~ DONE in Phase 6, on a file that did
  not matter: `storage.remove()` destroys the object, the row leaves
  `storage.objects`, and a signed URL minted beforehand stops serving. The
  reason the deletion lives in `src/lib/retention/purge.ts` rather than in SQL
  is confirmed rather than reasoned about. The purge has still never been run
  end to end against real licence images, because there are none and the
  24-month window has not come due.
- **A push actually arriving on a phone.** `web-push` signs and posts to
  Google's and Mozilla's services; with no VAPID keys configured nothing has
  ever been sent, the same honest state as the mailer. The sender, the targets,
  the sweep, the preferences and the wording are tested; the round trip to a
  real device is not, and wants doing on the pilot phones in October.
- **Actually sending an email.** `src/lib/email/mailer.ts` is complete and
  unexercised: there is no domain and no SMTP account (client item 8). The four
  `SMTP_*` variables are the only missing part.
- **The real contract terms and company details.** Client items 5 and 7. Until
  they arrive every agreement is a stamped DRAFT and the signing step refuses.
- **The TWA wrapper, the Play listing and `manifest.webmanifest`.** All three
  are blocked on client item 8 — a domain and a Play developer account — and
  none should be started without the domain, because the TWA's asset-links
  verification is bound to it. `src/proxy.ts` already excludes the manifest
  path from its matcher, so adding one is a file and not a change.
- **WebAuthn / fingerprint unlock.** §21 offers "PIN or fingerprint"; the PIN is
  built. Rep-side password change has left this list rather than been done:
  §32 removed the password entirely, and the PIN it replaced it with is the
  boss's to issue by his own decision (0027), so there is nothing left here for
  a rep to change themselves. Fingerprint remains, and changes no data model.
- **A true token revocation on deactivation.** `profiles.active` is now
  authoritative in Postgres as well as in the app
  (`supabase/migrations/20260830150000_deactivation.sql`), so a deactivated
  account can do nothing with a live JWT. Revoking the token itself through the
  Supabase admin API would additionally stop it being presented at all; it is
  strictly an improvement, not a gap, and it must not become a second source of
  truth for whether somebody is staff.
- **`handovers.by_profile` and a direct `cash_handovers` insert.** Carried over
  from Phase 3's list, unchanged and still worth an hour: a rep can set
  `by_profile` to another profile on a booking they can already reach, and can
  insert a `cash_handovers` row with any amount. Neither moves a figure —
  `my_cash_in_hand()` counts bookings, and `admin_confirm_cash_handover()`
  makes every receipt a claim the boss confirms — but both are writes that say
  something untrue about who did what.
- **`{{ .Token }}` in the magic-link email template**, and with it the boss's
  ability to sign in at all. Blocked behind custom SMTP or a paid plan — see
  "What the real project confirmed". The single highest-priority item on this
  list, because it is the difference between the boss being able to open the
  app in October and not.
- **Backups and PITR.** None on the Free plan. A hard pre-production item for a
  database of scanned driving licences; not urgent while the project holds no
  real data.
- **`site_url` and the redirect allow-list**, both still pointing at
  `localhost`. Blocked on client item 8 and must be set before any deployed URL
  or TWA exists.
- **Six `app` functions without an explicit `search_path`** — `rental_days`,
  `today`, `touch_updated_at`, `audit_redact`, `window_from`, `window_to`. All
  SECURITY INVOKER, no live hijack path, but the repo's own rule says every
  function sets it. One line each.
- **Five CHECK-constrained columns that want to be real enums** —
  `car_models.transmission` and `.fuel_type`, `handovers.kind`,
  `damage_marks.view` and `.mark_type`. Doing so would delete a section of
  `src/lib/supabase/database.types.ts` and let the generator carry the unions
  itself.
- **`auth_rls_initplan` on ten policies.** The `(select auth.uid())` rewrite is
  semantics-preserving and worth doing, but it touches `bookings_select` and
  `bookings_update` and so wants the isolation suite run against it as its own
  change.
- **Staff training and the written runbook, in Greek.** Phase 5 in the build
  plan, and the one item on it that is not code.
