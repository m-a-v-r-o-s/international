# Implementation notes — Phases 0 to 4

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
(A6), R1's Today screen with cash in hand and hand-over, and end-to-end
verification of extensions with a same-category swap. 273 tests.

**Phase 4** — the private Storage bucket and signed URLs, licence capture with
Claude vision OCR, the photo per damage mark, the bilingual contract PDF,
on-screen signature capture with the emailed copy, and A10's contract half.
373 tests.

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

## Not done, and where it belongs

- **Screens.** R1–R7 and A1–A6 are built, and A10's contract half. Still to
  come, all Phase 5 per the build plan: A7 reports and CSV export, A8 users and
  hotels, A9 the audit-log viewer, A10's remaining half (the licence retention
  window and the default pick-up / drop-off windows), and R8's notification
  preferences (its language and PIN halves exist).
- **The signed-URL HTTP layer.** The authorisation decision behind a signed URL
  is tested against the real policies (`tests/db/storage-isolation.test.ts`);
  that a minted URL expires on time, and that the Supabase storage service
  consults those policies at all, is Supabase's own behaviour and is not
  simulated. Confirm it once against a real project before the October pilot.
- **Actually sending an email.** `src/lib/email/mailer.ts` is complete and
  unexercised: there is no domain and no SMTP account (client item 8), so
  nothing has ever been sent. The four `SMTP_*` variables are the only missing
  part.
- **The real contract terms and company details.** Client items 5 and 7. Until
  they arrive every agreement is a stamped DRAFT and the signing step refuses.
- **WebAuthn / fingerprint unlock.** §21 offers "PIN or fingerprint". The PIN
  is built; the platform authenticator is a Phase 5 addition that changes no
  data model.
- **Retention purge job** for licence images. Phase 5, per the build plan. The
  `images_purged_at` column and the settings value are in place, and the bucket
  layout is what the sweep reads: `delete from storage.objects where bucket_id
  = 'booking-files' and (storage.foldername(name))[2] = 'licences'`, joined to
  the bookings whose rental ended more than `licence_retention_months` ago. A
  test already exercises exactly that query as the service role.
- **CI.** The isolation suite is meant to run on every change
  (`docs/05-BUILD-PLAN.md`, risks table). `npm test` is ready for it; the
  workflow itself is not written.
