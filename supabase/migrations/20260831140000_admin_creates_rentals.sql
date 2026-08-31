-- ═════════════════════════════════════════════════════════════════════════════
-- 0026 · An admin may create a rental (docs/01-DECISIONS.md §30)
--
-- "Even the boss makes bookings sometimes." Until this migration he could not,
-- and the failure was not a missing link — it was a NOT NULL violation waiting
-- at the end of a form he had no way to reach.
--
-- app.bookings_before_write() fills `created_by` inside `if not v_is_admin`,
-- along with the other fields a rep is not trusted to send. For an admin actor
-- that whole block is skipped — correctly, because an admin MAY set a status,
-- a price and a kind — but `created_by` was in it, and `created_by` is not a
-- privilege the admin branch was carving out. It is the row's author, it is
-- `not null` with no default (0005), and it is absent from the INSERT grant
-- for `authenticated` (0011) — for the admin too, so it cannot be supplied
-- from a client either. An admin INSERT therefore reached the constraint with
-- a null in it every time.
--
-- Nothing hit it before now because the only admin insert path in the app is
-- public.admin_create_block(), which passes `created_by := auth.uid()` itself.
--
-- The fix is a second BEFORE trigger, not an edit to the guard. That function
-- is 200 lines of load-bearing transition rules, it has already been re-pasted
-- whole once (0015), and 0021 declined to paste it again for exactly this
-- reason. Row-level BEFORE triggers fire in name order, so `bookings_guard`
-- still settles every field it protects and `bookings_owner` only ever fills a
-- `created_by` the guard left null:
--
--     bookings_guard  →  bookings_owner  →  bookings_window_override
--
-- Filling only a null is what keeps this a backstop rather than a rule of its
-- own. A rep's row arrives here already stamped by the guard with
-- `coalesce(auth.uid(), …)`, so their behaviour — including 0011's test that a
-- rep sending another rep's id is overwritten with their own — is untouched.
-- A service-role insert, which has no auth.uid(), still has to name an author
-- as it always did; seeds and fixtures are not silently given one.
-- ═════════════════════════════════════════════════════════════════════════════

-- SECURITY INVOKER, like app.touch_updated_at() and unlike the guard: this
-- reads no table and calls nothing privileged, so it has no business running
-- as the definer. auth.uid() is a session setting, readable by whoever is
-- asking.
create or replace function app.bookings_set_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only ever a fill, never an overwrite: the guard has already had its say
  -- for a rep, and an admin acting as one is the author of what they create.
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger bookings_owner
  before insert on public.bookings
  for each row execute function app.bookings_set_creator();

-- 0025 withdrew Postgres's built-in EXECUTE-to-PUBLIC across `app` and wrote
-- the same withdrawal as a default privilege so that later functions would be
-- covered without anyone remembering. In practice they are not: there is no
-- pg_default_acl row for this schema, so a function created after 0025 arrives
-- with proacl null — the built-in grant, intact. This one is therefore revoked
-- by name, the way 0025's one-shot revoke reached everything before it.
--
-- tests/db/privileges.test.ts is what found this, by asserting the exact list
-- of `app` functions `authenticated` may execute. It failed on the addition of
-- this function, which is the test doing precisely its job. The next function
-- added to this schema needs the same line until the default is fixed.
revoke all on function app.bookings_set_creator() from public;
