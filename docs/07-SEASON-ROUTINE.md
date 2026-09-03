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

   **The Railway half of that was not done on the same day the code was, and
   this section wrongly recorded it as if it had been.** For a few hours on
   3 Sep 2026 all three `notify-*` services were still live and still starting
   `npm run notify`, an npm script the very commit they were running had
   deleted: every fire failed instantly, `notify-exceptions` failed every five
   minutes, and nothing at all was keeping the Supabase project awake. Nobody
   would have noticed from the app. That is the whole argument for this
   document — a cron that fails looks exactly like a cron with nothing to do.

   The correction, applied to Railway the same day: `notify-morning`,
   `notify-evening` and `notify-exceptions` are all **deleted**, and a new
   service named **`keep-alive`** carries the heartbeat. The earlier draft of
   this section kept `notify-exceptions` alive under its wrong name on the
   grounds that rebuilding the awake-keeping service was riskier than the bad
   label; that reasoning was overtaken by the fact that the service was not
   keeping anything awake. The rebuild was done in the safe order — the new
   service was created, deployed and seen to run before any of the three old
   ones was removed.

   | Service | Schedule | Command |
   |---|---|---|
   | `keep-alive` | `*/5 * * * *` — every 5 minutes, all year | `npm run keep-alive` |
   | `purge-licences` | `0 0 1 * *` — monthly | `npm run purge:licences` |

   Both are the same shape: GitHub source `m-a-v-r-o-s/international` on
   `master`, build command `true` (a cron runs a script, it does not need
   `next build`), restart policy `NEVER` so a failed run is not retried into a
   loop. `keep-alive` reads its four environment variables as Railway
   references to the `international` service (`${{international.…}}`) rather
   than as its own copies, so rotating a key in one place rotates it here too.

   One trap for whoever adds the next cron here: `railway.json` at the repo
   root is config-as-code for the *web* service — `NIXPACKS`, `npm run build`,
   `npm run start`, a healthcheck on `/login` — and a newly created service
   picks it up before its own settings have taken hold. `keep-alive`'s first
   build ran a full `next build` for that reason. Set the service's build and
   start commands, then trigger a second build, and check the log actually
   shows the cheap path before trusting it.

   **Do not disable or delete the keep-alive service to save cost over the
   winter** — same reasoning as before: as long as it keeps running there is
   no realistic way for the free-tier pause to happen by inactivity. If it is
   ever replaced again, check a real run's logs for `keep-alive: ok`; a green
   "deployed" badge only says the container built.

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
