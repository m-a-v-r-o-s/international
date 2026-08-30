-- ─────────────────────────────────────────────────────────────────────────────
-- 0001 · Extensions and the internal `app` schema
--
-- btree_gist is required by the exclusion constraint that guarantees a car can
-- never be double-booked (docs/02-ARCHITECTURE.md, Engine 1). Do not drop it.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- Internal helpers, guards and rate-limit state. Nothing in here is queryable by
-- a client directly; `authenticated` only ever gets EXECUTE on named functions.
create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ── The day rule ────────────────────────────────────────────────────────────
-- A day is morning to night, not 24 hours. Mon → Wed is THREE days and the car
-- is held through the whole of Wednesday (docs/01-DECISIONS.md §4).
-- Every duration in this codebase goes through this function. `end - start` is
-- never the answer.
create or replace function app.rental_days(p_start date, p_end date)
returns integer
language sql
immutable
parallel safe
as $$
  select (p_end - p_start) + 1
$$;

comment on function app.rental_days(date, date) is
  'Inclusive day count: Mon pickup -> Wed return = 3 days (docs/01-DECISIONS.md §4).';

-- ── "Today" ─────────────────────────────────────────────────────────────────
-- The database runs in UTC; the business runs in Greece. A rep''s "today" ends
-- at midnight in Athens, not at 03:00 local. Anything day-shaped uses this.
create or replace function app.today()
returns date
language sql
stable
parallel safe
as $$
  select (now() at time zone 'Europe/Athens')::date
$$;

grant execute on function app.rental_days(date, date) to authenticated, service_role;
grant execute on function app.today() to authenticated, service_role;
