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
