/**
 * The company's calendar day.
 *
 * A rep's day ends at midnight where they are standing, not in UTC, and
 * `my_cash_in_hand()` measures "today" in `Europe/Athens` for exactly that
 * reason (supabase/migrations/20260830090900_engines.sql). Every screen that
 * asks "what is today" has to agree with it, so the answer lives in one place.
 *
 * This is not a rental-day calculation. The inclusive-day rule
 * (HANDOFF.md, docs/01-DECISIONS.md §4) stays in the database, in
 * `app.rental_days()`, and is reached from TypeScript through
 * `public.rental_days()` — never re-implemented here.
 */
export function todayAthens(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' })
}

/**
 * A calendar date plus a wall-clock time at the hotel desk, as an instant.
 *
 * Postgres does the conversion, not JavaScript: the literal names the zone, so
 * `timestamptz` resolves it with the same tz database that app.today() and
 * app.outside_default_windows() use. Doing it here with a Date would bake in
 * whatever zone the Railway container happens to run in, and would get the
 * March and October changeovers wrong in a country that observes both.
 *
 * A missing time is null rather than a guess — the columns have always been
 * nullable, and every booking made before R3 collected times has null in them.
 *
 * Shared by R3 and R3b rather than written twice: two copies of a timezone
 * conversion are two chances to fix one of them.
 */
export function athensInstant(date: string, time: string | undefined): string | null {
  return time ? `${date} ${time}:00 Europe/Athens` : null
}

/**
 * The wall-clock time at the hotel desk, as `HH:MM`.
 *
 * Used to pre-fill a pick-up time for a walk-in, whose rental starts when they
 * are standing there rather than in the morning window (docs/01-DECISIONS.md
 * §5). Same reasoning as todayAthens(): the container's own clock zone is not
 * the company's.
 */
export function nowTimeAthens(): string {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Athens', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
