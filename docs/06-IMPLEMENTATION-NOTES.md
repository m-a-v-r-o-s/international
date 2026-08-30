# Implementation notes — Phases 0 to 3

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

- **Screens.** R1–R7 and A1–A6 are built. Still to come, all Phase 5 per the
  build plan: A7 reports and CSV export, A8 users and hotels, A9 the audit-log
  viewer, A10 settings, and R8's notification preferences (its language and PIN
  halves exist).
- **Storage bucket and signed URLs for licence images.** Phase 4, with the
  contract work. Phase 3 captures the typed licence fields only, and
  `front_image_path` / `back_image_path` stay null. The database half of that
  isolation test is written and passes (a rep cannot read another booking's
  driver row); the signed-URL half needs the bucket to exist.
- **A photo per damage mark** (`damage_marks.photo_path`, `docs/01-DECISIONS.md`
  §12). This is the one piece of R4 step 4 that Phase 3 does not deliver, and
  the reason is the bucket above: there is nowhere for the file to go. A file
  input that collected a photo and discarded it would be worse than no input at
  all, so the control is not rendered. Everything else about a mark — view,
  position, type, note — is captured, so adding the photo is a field on an
  existing form plus an upload path, not a rework. When it lands, the
  accessible capture control is a plain `<input type="file" accept="image/*"
  capture>`: a bare file input is itself the non-camera path a keyboard or
  screen-reader user needs, and nothing more elaborate is required.
- **Licence OCR, the bilingual contract PDF, the on-screen signature and the
  emailed copy** — R4 steps 1, 5 and 6. Phase 4, per `docs/05-BUILD-PLAN.md`;
  not pulled forward. Manual driver entry is a first-class path either way
  (§10), so nothing built this phase is a placeholder waiting on them.
- **WebAuthn / fingerprint unlock.** §21 offers "PIN or fingerprint". The PIN
  is built; the platform authenticator is a Phase 5 addition that changes no
  data model.
- **Retention purge job** for licence images. Phase 5, per the build plan. The
  `images_purged_at` column and the settings value are in place.
- **CI.** The isolation suite is meant to run on every change
  (`docs/05-BUILD-PLAN.md`, risks table). `npm test` is ready for it; the
  workflow itself is not written.
