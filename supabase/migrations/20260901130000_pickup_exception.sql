-- ═════════════════════════════════════════════════════════════════════════════
-- 0027 · Pick-up windows become a rule; drop-off stays a default
--
-- docs/01-DECISIONS.md §5 used to read "these are defaults, overridable per
-- booking" for both times. 0021 built exactly that: `window_override` is a
-- fact the database derives after the fact, and nothing ever stopped a rep
-- typing 03:00 into the pick-up field.
--
-- The boss's instruction changes half of that. Pick-ups now have to be inside
-- the window the boss sets — a rep books whenever a guest wants a car, but
-- WHEN the desk hands the keys over is the boss's rule, not a suggestion. A
-- guest who is genuinely landing at 03:00 still needs a booking, so the rule
-- has a deliberate door in it: a rep can flag the booking as an exception and
-- say why, and only then does the out-of-window pick-up go through.
--
-- Drop-off is untouched. The boss did not ask for it, and there is no equally
-- firm operational reason to lock it — the desk collecting a car late in the
-- evening does not carry the same cost as a rep needing to be there before
-- the desk opens. `window_override` still derives from BOTH times, exactly as
-- 0021 left it; this migration adds a second, independent gate on pick-up
-- only.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.bookings
  add column pickup_exception boolean not null default false,
  add column pickup_exception_reason text;

-- A reason is required going one direction only: checking the box with
-- nothing typed is refused, but unchecking it later is never blocked by
-- whatever text is still sitting in the column — that text is history, not a
-- live claim.
alter table public.bookings
  add constraint bookings_pickup_exception_reason_required
    check (
      not pickup_exception
      or (pickup_exception_reason is not null and length(btrim(pickup_exception_reason)) > 0)
    );

/*
 * The gate itself. Unlike app.bookings_set_window_override() (which only
 * stamps a fact), this one can refuse the write outright — so it has to run
 * as its own trigger, not inside that function or inside bookings_guard.
 *
 * `app.outside_default_windows()` already takes a pickup and a dropoff and
 * says whether EITHER is outside its window; passing null for dropoff here
 * reuses that exact function to ask only the pick-up half of the question,
 * rather than re-deriving the Athens-time comparison a second time.
 *
 * A block has no customer and no times (bookings_block_is_bare keeps it that
 * way), so it is exempt the same way 0021's derivation is.
 */
create or replace function app.bookings_enforce_pickup_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'block'
     and not new.pickup_exception
     and app.outside_default_windows(new.pickup_at, null) then
    raise exception using errcode = 'IR116',
      message = 'pick-up is outside the manager''s window and no exception was recorded';
  end if;
  return new;
end;
$$;

-- Fires after bookings_guard/bookings_owner have settled pickup_at and kind
-- (row-level BEFORE triggers run in name order: guard → owner → pickup_window
-- → window_override).
create trigger bookings_pickup_window_guard
  before insert or update on public.bookings
  for each row execute function app.bookings_enforce_pickup_window();

-- Every function added to `app` since 0025 needs this by name — there is no
-- pg_default_acl row for the schema, so the ALTER DEFAULT PRIVILEGES that
-- migration wrote never actually catches a function created afterwards.
revoke all on function app.bookings_enforce_pickup_window() from public;

-- The two new columns join the same insert/update/select grants pickup_at,
-- dropoff_at and window_override already sit in (0011, 0021) — a rep is the
-- one who ticks the box and writes the reason, both are ordinary rep-owned
-- fields, and Postgres column grants are additive so the original grant
-- statements do not need to be touched.
grant select (pickup_exception, pickup_exception_reason) on public.bookings to authenticated;
grant insert (pickup_exception, pickup_exception_reason) on public.bookings to authenticated;
grant update (pickup_exception, pickup_exception_reason) on public.bookings to authenticated;
