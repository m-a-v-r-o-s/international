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
2. **The four Railway cron services are what's currently preventing that
   pause, and they're already doing it unconditionally.** Confirmed schedules
   in the `International Rent-a-Car App` Railway project:

   | Service | Schedule |
   |---|---|
   | `notify-incidents` | `*/5 * * * *` — every 5 minutes, all year (verified in Railway 2 Sep 2026) |
   | `notify-morning` | `0 5 * * *` — daily |
   | `notify-evening` | `30 14 * * *` — daily |
   | `purge-licences` | `0 0 1 * *` — monthly |

   Railway fires these on schedule regardless of content, and the code behind
   each one hits a Supabase RPC *before* it checks whether there's anything to
   send or purge (`notifyMorningPickups`/`notifyEveningReturns` call
   `rep_day_movements` first; `notifyPendingIncidents` calls
   `pending_incident_notifications` first; `purgeLicenceImages` calls
   `licence_images_due_for_purge` first). An empty off-season still means a
   real API call every five minutes via `notify-incidents` alone — nowhere near
   Supabase's 7-day inactivity threshold. **Do not disable or delete these
   services to save cost over the winter** — that's what's keeping the
   project awake between the boss's visits, and as long as they keep running
   there is no realistic way for the pause to happen by inactivity.

   **This service's command changed on 2 Sep 2026** (docs/01-DECISIONS.md
   §34) and was updated in Railway the same day: it runs
   `npm run notify -- --incidents`, and the old `--exceptions` flag no longer
   exists.

   **The service is still NAMED `notify-exceptions`, and should be renamed to
   `notify-incidents` in the dashboard** (Settings → the service's name). It
   has to be done by hand: Railway's API has no rename field, so the only
   programmatic route — the one its own agent offers — is to delete the
   service and recreate it with the same configuration. Do not take that
   offer. This is the service whose 5-minute cadence keeps the Supabase
   project from auto-pausing (§1), and destroying and rebuilding it to correct
   a label risks the one thing this document exists to prevent. The command is
   what runs; the name is only what it is called.

   **Correction, 2 Sep 2026.** This section previously recorded the schedule as
   `* * * * *`, every 1 minute, "changed 1 Sep 2026 at the owner's request".
   That is not what is deployed: Railway reports `*/5 * * * *`, and 5 minutes
   is Railway's own minimum interval for a cron service, so a 1-minute cadence
   was never possible here. The conclusion this section draws is unaffected —
   a call every 5 minutes is just as far from a 7-day inactivity threshold as
   one every minute — but the number was wrong and load-bearing enough to be
   worth correcting rather than carrying forward.

   A push is not sent every five minutes either: `notifyPendingIncidents()`
   (`src/lib/push/notify.ts`) always makes the RPC call the cron cadence exists
   to guarantee, but only sends when `pending_incident_notifications()`
   actually returns something, and stamps `notified_at` on every item it sends
   so the same incident is never announced twice — an idle run is a wasted
   round trip, never a notification. **This schedule lives on the Railway
   service itself, not in this repository** — changing it means editing the
   cron service's schedule in the Railway dashboard (or via the Railway MCP
   tool); nothing in `supabase/migrations` or `scripts/send-notifications.ts`
   is involved.
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
5. **Leave all four Railway cron services running, untouched, through the
   winter.** See §1 — `notify-incidents`'s 5-minute cadence is what keeps
   the free-tier Supabase project from auto-pausing, so pausing, deleting, or
   "cleaning up" any of the four to save a little Railway cost is the one
   thing that actually creates the pause risk this doc exists to avoid.

## §1 — the Supabase pause decision

Already decided, and already in place: **stay on free, and let the four
Railway cron services carry it.** `notify-incidents` alone, firing every
five minutes year-round and always issuing a real Supabase RPC call first, makes
the 7-day auto-pause threshold unreachable by inactivity. Nothing further to
do here as long as those services keep running (§ End of season point 6) —
the only way this breaks is those services themselves stopping (paused,
deleted, or the Railway project/billing lapsing), not the app going quiet.

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
8. **Smoke-test the notification paths** — `notify-morning` and
   `notify-evening` — now, with real reps signed in, rather than discovering
   in the first week that push subscriptions from 6 months ago are all
   expired (`push_subscriptions` rows go stale when a rep re-installs or
   clears the PWA over the winter; a rep's first sign-in of the season
   re-subscribes them, but it's worth confirming rather than assuming).

## Scope note

This is deliberately a checklist, not a feature. Nothing above needed new
code — `profiles.active`, `reissueRepPin()`, the retention purge, and
`admin/pricing`'s per-`season_year` model already do everything this routine
asks of them. If a future off-season surfaces a real gap (e.g. re-activating
12 reps one row at a time turns out to be too slow to bother doing), that's a
reason to revisit this as a feature request then, against the actual pain
rather than a guess at it now.
