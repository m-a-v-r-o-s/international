# End-of-season / start-of-season routine

The business runs roughly May–October. For the other ~6 months the only person
who touches the app is the boss, occasionally, usually to add a car he's just
bought. Reps are seasonal and their accounts should not sit active and
unwatched over the winter. This doc is what to do at both ends of that gap. It
is a checklist for **Akos** to run (or to hand to the boss as instructions),
not app functionality — see the note on scope at the bottom.

Nothing here overrides `docs/01-DECISIONS.md`. Where this doc recommends
deactivating reps or reviewing retention, those are operational uses of
features that already exist (`profiles.active`, the retention purge), not new
rules.

## Why this needs a checklist at all

Three things about this project make "just leave it alone for 6 months" a bad
plan:

1. **The Supabase project is on the free plan.** Confirmed live: org "Akos
   Digital Services" (`yvbawszeinuuwbzljnrc`), project `international-rentals`
   (`jhjzcrypzpvevxouuejm`), plan `free`. Free-tier projects auto-pause after
   7 days with no API activity. A paused project stops answering — including
   the boss's own login — until someone resumes it from the Supabase
   dashboard. Left paused long enough, a free project can be deleted outright.
   This is the single biggest risk in this list; see §1.
2. **A dedicated `keep-alive` Railway cron is what's currently preventing that
   pause.** Push notifications (docs/01-DECISIONS.md §22) were removed
   outright on 3 Sep 2026 (§36) — settings UI, service worker, sender, schema,
   and the three `notify-*` cron services that used to carry this side effect
   as a byproduct of sending digests. Removing the notification code removed
   that side effect too, so it needed a replacement with no notification logic
   at all: `scripts/keep-alive.ts`, run as `npm run keep-alive`, does one
   cheap authenticated read against `app_settings` and nothing else.

   The old `notify-exceptions` service (previously the incidents sender,
   `*/5 * * * *` — Railway's minimum interval, and the fastest of the three
   old schedules, which is why it was the one repurposed rather than deleted)
   now runs `npm run keep-alive` on the same 5-minute cadence. `notify-morning`
   and `notify-evening` had no keep-alive role of their own — their schedules
   were daily, nowhere near tight enough on their own to matter against a
   7-day threshold — and were deleted outright rather than repurposed.

   | Service | Schedule | Command |
   |---|---|---|
   | `notify-exceptions` (name unchanged — see below) | `*/5 * * * *` — every 5 minutes, all year | `npm run keep-alive` |
   | `purge-licences` | `0 0 1 * *` — monthly | `npm run purge:licences` |

   **Do not disable or delete the keep-alive service to save cost over the
   winter** — same reasoning as before: as long as it keeps running there is
   no realistic way for the free-tier pause to happen by inactivity.

   **The service is still NAMED `notify-exceptions`.** Railway's API has no
   rename field, so renaming it means deleting and recreating it by hand in
   the dashboard (Settings → the service's name) — deliberately not done here,
   for the same reason it wasn't done when this section first flagged it: this
   is the service whose cadence keeps the project awake, and destroying and
   rebuilding it to correct a label risks the one thing this document exists
   to prevent. The command is what runs; the name is only what it is called.
3. **The boss's login is email + one-time code (§21).** That depends on
   Supabase Auth actually being able to send mail, which depends on the
   project being unpaused and (once a domain/SMTP exists) on that SMTP
   account still being valid. A dead mail sender is invisible until the one
   day a year the boss needs it.

## End of season

Run this once, shortly after the last car of the year comes back.

1. **Confirm the retention purge is current.** `npm run purge:licences -- --dry`
   against production, or check the `purge-licences` Railway cron's last run.
   Nothing unusual should be due — the monthly cadence should already have
   caught the season's early bookings by now. This is the last checkpoint
   before six months where nobody would notice if it silently stopped.
2. **Deactivate seasonal reps, don't delete them.** For each rep whose season
   is over: admin → Users → set `active = false` (existing screen, existing
   column). This isn't a new rule — `currentStaff()` already refuses a
   session for `active !== true` — it's just making sure it's actually done
   for everyone before the account sits untouched for months. Leave the
   `profiles` row and their booking history in place; a rep coming back next
   year is a re-activation, not a re-hire in the database.
3. **Rotate or clear anything a rep could still use.** A deactivated account
   can't sign in, but if a rep's device is still bound (`rep_device_matches`)
   and their temp/chosen password leaked, that's dormant risk for 6 months
   for no reason. Re-issuing the password on next reactivation (§ below) is
   enough — no action needed now beyond confirming `active = false` actually
   blocks them, which the isolation tests already cover.
4. **Snapshot where pricing landed.** No action needed in the data — pricing
   periods are already kept per `season_year` and never overwritten — but
   worth the boss glancing at `admin/pricing` to confirm this year's periods
   look right before they become "last year's reference" for setting next
   year's prices.
5. **Leave both Railway cron services running, untouched, through the
   winter.** See §1 — `keep-alive`'s 5-minute cadence is what keeps
   the free-tier Supabase project from auto-pausing, so pausing, deleting, or
   "cleaning up" the keep-alive service to save a little Railway cost is the
   one thing that actually creates the pause risk this doc exists to avoid.

## §1 — the Supabase pause decision

Already decided, and already in place: **stay on free, and let the
`keep-alive` Railway cron carry it.** Firing every five minutes year-round,
always issuing a real Supabase read, it makes the 7-day auto-pause threshold
unreachable by inactivity. Nothing further to do here as long as it keeps
running (§ End of season point 5) — the only way this breaks is the service
itself stopping (paused, deleted, or the Railway project/billing lapsing),
not the app going quiet.

The fallback, only worth it if that dependency ever becomes uncomfortable:
**upgrade the org to Pro**, which removes the auto-pause mechanism entirely
regardless of what runs. A flat monthly cost trade against depending on
Railway services nobody's watching for 6 months — not needed today, but worth
knowing it's there if the calculus changes.

## Start of season

Run this before the first rep of the new season needs to sign in.

1. **Confirm the Supabase project is actually live**, not paused — check the
   dashboard before doing anything else. If it was paused, resume it and give
   it a few minutes before testing sign-in.
2. **Boss signs in and confirms the OTP mail actually arrives.** This is the
   one login of the year that matters most to get right early — if the mail
   sender (Supabase's own, or SMTP once configured) has gone stale over the
   winter, better to find out now than at a hotel desk in May.
3. **Re-activate returning reps, create new ones.** Admin → Users. A
   returning rep gets `active = true` again — existing row, same history. A
   genuinely new rep goes through the normal `createRepAccount` flow
   (PIN shown once, handed over in person per
   `src/lib/users/accounts.ts`).
4. **Reissue a PIN for every returning rep**, don't reuse whatever they had in
   October. "Issue a new PIN" on the person's page (`reissueRepPin()`) already
   exists for this — it's the same action used when a rep loses their PIN, just
   applied to everyone coming back. Cheap, and it means a credential that's been
   sitting unused and unrotated for 6 months is never the one still open.
5. **Confirm hotel assignments still match reality** (`hotel_reps`) — hotels
   change reps between seasons more often than the schema changes.
6. **Set up this year's pricing periods** in `admin/pricing` before the first
   booking, using last year's as the starting reference (§ End of season
   point 4).
7. **Confirm the fleet is current.** Any car the boss mentioned adding
   "now and then" over the winter should already be in `cars` via the normal
   admin flow — this is just the checkpoint to catch one that was bought but
   never actually entered. Archive (`archived_at`) anything sold over the
   winter rather than deleting it — booking history references it.
8. **Confirm the `keep-alive` cron is still green** in the Railway dashboard
   — its last run should be within the last few minutes. Nothing else to
   smoke-test here: there is no notification path left to go stale.

## Scope note

This is deliberately a checklist, not a feature. Nothing above needed new
code — `profiles.active`, `reissueRepPin()`, the retention purge, and
`admin/pricing`'s per-`season_year` model already do everything this routine
asks of them. If a future off-season surfaces a real gap (e.g. re-activating
12 reps one row at a time turns out to be too slow to bother doing), that's a
reason to revisit this as a feature request then, against the actual pain
rather than a guess at it now.
