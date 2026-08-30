-- ═════════════════════════════════════════════════════════════════════════════
-- 0021 · The default pick-up and drop-off windows (docs/01-DECISIONS.md §5)
--
-- "Pickups 08:30–11:30, drop-offs 18:00–21:00. These are DEFAULTS,
-- OVERRIDABLE per booking. The override is recorded."
--
-- Two gaps, found building A10's remaining half:
--
-- 1. NOTHING EVER WROTE pickup_at OR dropoff_at. Both columns have existed
--    since Phase 1 and are read in six places — R1's Today screen sorts by
--    them, A1's movements sheet sorts and prints them, the contract prints
--    them — but R3 collected no times, so every booking carried null and the
--    boss's morning screen sorted a column of blanks. docs/04-SCREENS.md R3
--    step 1 asks for both, with the windows as their defaults. R3 now collects
--    them; this migration is what makes the default and the override mean
--    something.
--
-- 2. `window_override` WAS THE CLIENT'S OPINION. It sits in the rep's INSERT
--    and UPDATE grant, so a rep could book a 03:00 pick-up with
--    window_override = false, or stamp an override on an ordinary one. §5 says
--    the override is RECORDED — and a recorded fact a caller supplies is not
--    recorded, it is claimed. Same family as contracts.signed_at in 0017, and
--    the same fix: the database derives it, for the admin too.
--
-- The derivation lives in its own BEFORE trigger rather than inside
-- app.bookings_before_write(). That function is 200 lines of load-bearing
-- transition rules and has already been re-pasted whole once (0015); pasting
-- it again to add two lines is how a silent divergence gets introduced.
-- Postgres fires row-level BEFORE triggers in name order, and
-- `bookings_guard` sorts before `bookings_window_override`, so the guard still
-- has the last word on every field it protects — this one only ever reads the
-- two timestamps the guard has already settled.
-- ═════════════════════════════════════════════════════════════════════════════

-- A window is 'HH:MM-HH:MM' and the check makes that true rather than hoped
-- for: A10 writes this column, and a malformed value would otherwise surface
-- as a cast error inside a trigger on an unrelated booking insert.
alter table public.app_settings
  add constraint app_settings_pickup_window_format
    check (pickup_window ~ '^[0-2][0-9]:[0-5][0-9]-[0-2][0-9]:[0-5][0-9]$'),
  add constraint app_settings_dropoff_window_format
    check (dropoff_window ~ '^[0-2][0-9]:[0-5][0-9]-[0-2][0-9]:[0-5][0-9]$');

create or replace function app.window_from(p_window text)
returns time
language sql
immutable
as $$
  select split_part(p_window, '-', 1)::time
$$;

create or replace function app.window_to(p_window text)
returns time
language sql
immutable
as $$
  select split_part(p_window, '-', 2)::time
$$;

/*
 * Is either time outside its window?
 *
 * The comparison is made in Athens time, because the window is a fact about
 * the hotel desk and not about UTC — the same reason app.today() exists. A
 * null time cannot be outside anything: a booking made before the times were
 * collected is not retrospectively an override.
 */
create or replace function app.outside_default_windows(
  p_pickup timestamptz,
  p_dropoff timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      (p_pickup is not null and
        ((p_pickup at time zone 'Europe/Athens')::time < app.window_from(s.pickup_window)
         or (p_pickup at time zone 'Europe/Athens')::time > app.window_to(s.pickup_window)))
      or
      (p_dropoff is not null and
        ((p_dropoff at time zone 'Europe/Athens')::time < app.window_from(s.dropoff_window)
         or (p_dropoff at time zone 'Europe/Athens')::time > app.window_to(s.dropoff_window)))
    from public.app_settings s
    where s.id = 1
  ), false)
$$;

comment on function app.outside_default_windows(timestamptz, timestamptz) is
  'Whether a booking''s pick-up or drop-off falls outside the admin-set windows, in Athens time. The source of bookings.window_override — never the client''s claim (docs/01-DECISIONS.md §5).';

create or replace function app.bookings_set_window_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A block has no customer and no times; the bookings_block_is_bare
  -- constraint keeps it that way, and an override on one would be meaningless.
  if new.kind = 'block' then
    new.window_override := false;
  else
    new.window_override := app.outside_default_windows(new.pickup_at, new.dropoff_at);
  end if;
  return new;
end;
$$;

create trigger bookings_window_override
  before insert or update on public.bookings
  for each row execute function app.bookings_set_window_override();

-- ── The defaults R3 offers ──────────────────────────────────────────────────
-- A rep opening the new-booking screen needs the window to show as a hint and
-- its start as the pre-filled time. app_settings is already readable by any
-- signed-in staff member (`app_settings_select` is `using (true)`), so this is
-- a convenience for the form rather than a new permission — but it is a public
-- wrapper so the screen reads the times through one accessor rather than
-- parsing the column in TypeScript, which would be a second implementation of
-- the format the check constraint above defines.
create or replace function public.booking_windows()
returns table (pickup_from text, pickup_to text, dropoff_from text, dropoff_to text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_staff();

  return query
  select to_char(app.window_from(s.pickup_window), 'HH24:MI'),
         to_char(app.window_to(s.pickup_window), 'HH24:MI'),
         to_char(app.window_from(s.dropoff_window), 'HH24:MI'),
         to_char(app.window_to(s.dropoff_window), 'HH24:MI')
  from public.app_settings s
  where s.id = 1;
end;
$$;

revoke all on function public.booking_windows() from public;
grant execute on function public.booking_windows() to authenticated, service_role;
