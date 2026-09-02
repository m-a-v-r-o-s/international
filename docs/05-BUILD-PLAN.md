# International Rentals — Build Plan

**Today:** 30 Aug 2026 · **Test build:** early Oct 2026 · **Launch:** 1 Mar 2027

## An honest read on the October date

The brief is "as close to release as possible" in roughly **five weeks**. That is
achievable for the operational core, and tight for everything at once. The plan below is
ordered so that if the schedule slips, **what slips is the least operationally critical
thing**, and the test build is still a fair test of the parts that matter.

Ranked by what must be right before anyone can judge the system:

1. Availability and pricing engines — wrong here and everything downstream is wrong
2. Rep isolation — the commercial promise of the product
3. The pickup and return flows — where the reps live all day
4. The contract PDF and signature — the actual paper replacement
5. Licence OCR — a convenience over manual entry, which always works
6. Reports, push, Play Store listing — valuable, not load-bearing for a test

**If something must give, it gives from the bottom.** OCR degrades gracefully to typing.
The TWA wrapper can be added any time without touching the app. Reports can wait for real
data to exist.

---

## Phase 0 — Foundations · ~3 days
- Next.js + TypeScript + Tailwind scaffold on Railway; Supabase project; environments.
- Design tokens from the personal system, tuned for International Rentals' brand.
- i18n wiring (`next-intl`, el/en) from the very first screen — retrofitting this is misery.
- Auth: admin OTP, rep password + PIN, session handling, admin concurrent sessions.
- Base security headers, CSP, cookie flags, rate limiting middleware.

**Done when:** an admin and a rep can log in on a phone, in either language, over HTTPS.

## Phase 1 — Data & the two engines · ~1 week
- Full schema, including the exclusion constraint.
- RLS policies on every table, plus the `availability()` SECURITY DEFINER function.
- `quote()` pricing RPC.
- **The test suite for both engines** (see below). Write these before the UI.
- Fleet CSV import; categories; pricing period + price table admin screens.

**Done when:** 100 real cars and one real price period are in, and the engine tests pass.

## Phase 2 — Booking core · ~1 week
- Availability screen (R2), new booking (R3), booking detail (R7), my bookings (R6).
- Admin: fleet — board and car management in one (A2 + A3), bookings (A5), movements sheet (A1).
- Audit logging on every write.

**Done when:** a rep can find a free car, book it, and the boss can see it on the day sheet.

## Phase 3 — Pickup & return · ~1 week
- Pickup flow (R4) end to end: camera capture, eligibility gate, fuel, damage diagram.
- Return flow (R5), early-return release of remaining dates.
- Incidents queue (A6). Cash in hand + hand-over.
- Extensions with same-category car swap.

**Done when:** a full rental can be run from booking to return without paper — except the
signature.

## Phase 4 — Contract & OCR · ~1 week
- Bilingual PDF generation with the damage diagram and both drivers' details.
- On-screen signature capture, embedding, storage, optional email delivery.
- Claude vision OCR with strict schema parsing, confidence display and manual fallback.

**Done when:** a guest signs on the phone and gets a real agreement.

## → Early October: test build to the boss and two reps

Pilot at **one hotel**, running in parallel with paper for a fortnight. Paper is the safety
net, and the comparison is the test. Collect: what took too many taps, what wasn't on the
screen when it was needed, what the reps worked around.

## Phase 5 — Oct 2026 → Feb 2027 · refinement
- Act on pilot feedback — this is the point of the October date, so leave real room for it.
- Reports (A7) and CSV export, once genuine data has accumulated.
- Push notifications: rep day reminders, admin incidents.
- TWA wrapper, Play Store listing and internal-testing track.
- Retention purge job, privacy/terms/cookie components, 404, favicon, OG image.
- WCAG 2.1 AA audit. Core Web Vitals verification on a real mid-range Android on 4G.
- Load test the movements sheet at 200 rows and the availability screen at 100 cars.
- Staff training and a written runbook, in Greek.

## → 1 March 2027: production launch
Two months of live running before the season opens on 1 May. That buffer is the plan's best
feature — do not spend it early.

---

## Tests that must exist before anything is called done

**Availability**
- Adjacent bookings: 12–15 Jul and 16–18 Jul on one car — legal.
- Touching bookings: 12–15 Jul and 15–18 Jul — **rejected by the database**.
- Full containment, partial overlap at each end, single-day rentals.
- Two concurrent transactions booking the last car — exactly one succeeds.
- A block overlapping a booking attempt — rejected.
- Early return frees the remaining dates; the price does not change.
- Cancelled and no-show bookings free their dates.
- Archived cars never appear in availability.

**Pricing**
- 1 through 7 days at each duration in each period.
- 8, 14, 30 days via the extra-day rate.
- A rental crossing a period boundary → priced by the **pickup date's** period.
- Pickup date in no defined period → **fails loudly**, does not guess.
- Editing a price table does not alter any existing booking's stored total.
- Extras add nothing.

**Isolation — the ones that matter commercially**
- Rep A calls every endpoint with Rep B's booking id → denied every time.
- `availability()` output contains no rep, hotel, price, reason or booking id.
- No API response reachable by a rep contains an aggregate other than their own daily cash.
- A rep cannot read `block_reason`, the price tables, the audit log or another hotel's rows.
- A rep POSTing `total`, `role` or `created_by` has those fields ignored, not applied.
- A rep's signed URL for their own licence image does not grant another booking's image.

**Eligibility**
- Age 20 on category A → blocked. Age 22 on category C → blocked. Age 22 on category B → allowed.
- Licence issued 11 months ago → blocked.
- Licence expiring during the rental → blocked.
- Admin override unblocks, and is recorded on the booking.

---

## Risks

| Risk | Handling |
|---|---|
| Five weeks is tight for a near-release build | Strict ordering above; OCR and reports are the designated slip |
| Category/model/price data hasn't arrived yet | Blocks Phase 1's back half. **Chase it now** — it is the critical path |
| The paper contract's terms aren't in hand | Blocks Phase 4. Needed by mid-September at the latest |
| OCR accuracy on worn or non-EU licences | Manual entry is a first-class path, not a fallback screen. Never let OCR block a pickup |
| Reps work around the app under pressure | One-hotel pilot in parallel with paper; watch what they actually do |
| A rep discovers an aggregate the design didn't anticipate | The isolation test suite above runs in CI on every change |
| Play Store review delays near launch | TWA means bugfixes deploy as web updates and bypass review entirely |
| Peak-season load (200 movements/day) | Indexed queries, load-tested in Phase 5, well before May |
