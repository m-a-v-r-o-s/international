-- ─────────────────────────────────────────────────────────────────────────────
-- 0037 · Where a car sleeps, and the moves that get it there
--
-- A1 answers "what happens today": every pick-up and every return, in time
-- order. It cannot answer the question the boss actually asks at the end of the
-- day — *which cars have to go where tonight so the morning works*. A car
-- dropped at Μικρή Πόλη at 21:00 that is booked at Belvedere at 09:00 has to be
-- driven across in between, and nothing in the schema knew that, because
-- nothing in the schema knew where a car was.
--
-- Three pieces, deliberately separate (docs/01-DECISIONS.md §45):
--
--   · `cars.stationed_at` — the base a car currently belongs to. Not a live GPS
--     fix: while a rental is `out` the column still names the base the car left,
--     which is the useful answer, because that is where it would be if it were
--     not rented. A return corrects it automatically (the trigger below), so
--     the column converges on the truth through ordinary trading rather than
--     through anybody maintaining it.
--
--   · The derivation, which is NOT here. Tonight's needed moves are computed
--     from `bookings` every time the screen is opened (src/lib/relocations/
--     data.ts). Storing them would rot the moment a rental is extended, a car
--     is swapped or a booking is cancelled — the sheet would then be a record
--     of what was true when it was generated, which is precisely the failure
--     mode the paper day-sheet had.
--
--   · `car_relocations` — an overlay of the boss's DECISIONS only. A row exists
--     when, and only when, he touched that car on that night: invented a
--     destination no booking justifies, overrode a derived one, or ticked the
--     move off. Row existence is what makes an override an override, which is
--     why `to_hotel_id` is nullable: a row with it null is him saying "I can see
--     why you think this should move — leave it."
--
-- `is_depot` narrows §42 rather than overturning it. The office stays an
-- ordinary `hotels` row with real `hotel_reps`, and nothing here treats it
-- specially in booking, pricing, RLS or the contract renderer. The flag earns
-- its keep on this screen alone: the yard sorts to the top of a destination
-- list, and the label reads Γραφείο instead of being one more hotel name among
-- forty. Several are allowed — a second office costs nothing, because the flag
-- decides presentation and never routing (a car with nothing booked next stays
-- where it is, it is not swept to a depot).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The office, told apart from a hotel ─────────────────────────────────────
alter table public.hotels add column is_depot boolean not null default false;

comment on column public.hotels.is_depot is
  'This location is the company''s own yard/office rather than a hotel. Presentation only: it sorts first and labels differently on A13. Never routing — see docs/01-DECISIONS.md §45.';

-- `hotels` is granted at table level (20260830091100_rls.sql), not column by
-- column, so the new column needs no grant of its own and `hotels_admin_write`
-- already gates it.

-- ── Where a car sleeps ──────────────────────────────────────────────────────
-- ON DELETE SET NULL, not RESTRICT: a hotel typed in by mistake and deleted
-- should not be undeletable because a car happens to point at it. The car
-- simply becomes unplaced, which the screen shows as `—` and the next return
-- fixes. A hotel with real history is deactivated rather than deleted anyway
-- (admin/hotels/actions.ts), and `active = false` leaves this column intact.
alter table public.cars add column stationed_at uuid references public.hotels on delete set null;

create index on public.cars (stationed_at);

comment on column public.cars.stationed_at is
  'The base this car currently belongs to, not its instantaneous position: a car that is `out` still names the base it left. Written by app.cars_station_on_return(), public.admin_complete_relocation() and public.admin_set_car_station() — never by a client UPDATE, because the column is deliberately absent from the rep/admin update grant.';

-- Read by anyone signed in, written by nobody. A rep knowing which base a plate
-- belongs to is ordinary operational fact, so it joins the select whitelist
-- beside `plate` and `colour`. It joins NEITHER the insert nor the update
-- whitelist, for both roles including the admin — the three functions below are
-- the only doors, so there is no form field, no PostgREST call and no crafted
-- request body that can move a car's station without going through one of them.
grant select (stationed_at) on public.cars to authenticated;

-- ── The boss's decisions ────────────────────────────────────────────────────
create table public.car_relocations (
  -- The night the move belongs to: the evening of `night_of`, for the morning
  -- of `night_of + 1`. A date rather than a range because the business thinks
  -- in "tonight", and because the derivation's horizon is exactly one night.
  night_of      date not null,
  car_id        uuid not null references public.cars on delete cascade,
  -- NULL is meaningful: "stays put", chosen against a derived move. The
  -- distinction between that and "no decision made" is the row's existence.
  to_hotel_id   uuid references public.hotels on delete cascade,
  done_at       timestamptz,
  decided_by    uuid not null references public.profiles,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  primary key (night_of, car_id),
  -- A move cannot be ticked off as done without saying where it went, because
  -- ticking it is what moves `cars.stationed_at`. Enforced here as well as in
  -- the RPC: the constraint is the thing that cannot be forgotten.
  constraint car_relocations_done_has_destination
    check (done_at is null or to_hotel_id is not null)
);

create index on public.car_relocations (car_id);

comment on table public.car_relocations is
  'A13 · the boss''s overrides for one night''s car shuffle, NOT the shuffle itself. Derived moves are computed live from bookings and never stored here (docs/01-DECISIONS.md §45); a row means he decided something about this car on this night.';
comment on column public.car_relocations.to_hotel_id is
  'Destination. NULL means "stays where it is" — a deliberate decision against a move the derivation proposed, told apart from "no decision yet" by whether the row exists at all.';

-- Admin-only, the shape used for pricing (20260830091100_rls.sql): no rep
-- policy exists, so a rep selecting from this table gets an empty set whatever
-- filter they send. SELECT is the only grant — every write goes through the
-- SECURITY DEFINER functions below, so the row and `cars.stationed_at` cannot
-- drift apart by one of the two being written on its own.
alter table public.car_relocations enable row level security;

grant select on public.car_relocations to authenticated;

create policy car_relocations_admin_read on public.car_relocations
  for select to authenticated
  using (app.is_admin());

create trigger audit_car_relocations after insert or update or delete on public.car_relocations
  for each row execute function app.audit();

-- ── A return places the car ─────────────────────────────────────────────────
-- This is what makes `stationed_at` self-correcting, and why the column ships
-- empty rather than being backfilled with a guess: every car that comes back
-- places itself, so the nulls drain away over a couple of weeks of trading with
-- nobody typing anything.
--
-- An `adhoc_hotel_name` return is left alone on purpose. Free text cannot be a
-- foreign key, and minting a `hotels` row for a one-off would undo exactly what
-- §42 decided; such a car keeps whatever station it had and the boss corrects
-- it by hand if it matters.
create or replace function app.cars_station_on_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hotel_id is not null then
    update public.cars
       set stationed_at = new.hotel_id,
           updated_at   = now()
     where id = new.car_id
       and stationed_at is distinct from new.hotel_id;
  end if;

  return null;
end;
$$;

-- The WHEN clause carries the whole condition, so the function body is not
-- reached at all on the hundred other kinds of booking update.
create trigger bookings_station_on_return
  after update of status on public.bookings
  for each row
  when (new.kind = 'rental' and new.status = 'returned' and old.status is distinct from 'returned')
  execute function app.cars_station_on_return();

revoke all on function app.cars_station_on_return() from public, anon, authenticated;

-- ── The three doors ─────────────────────────────────────────────────────────

/**
 * Record a destination for one car on one night — or, with p_to null, that it
 * stays where it is. Re-deciding a move that was already ticked off clears the
 * tick: the move that was done is not the move now planned, and leaving
 * `done_at` standing would claim a car had been driven somewhere it had not.
 */
create or replace function public.admin_set_relocation(
  p_night date, p_car uuid, p_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  insert into public.car_relocations (night_of, car_id, to_hotel_id, decided_by)
  values (p_night, p_car, p_to, auth.uid())
  on conflict (night_of, car_id) do update
    set to_hotel_id = excluded.to_hotel_id,
        decided_by  = excluded.decided_by,
        updated_at  = now(),
        done_at     = case
                        when car_relocations.to_hotel_id is distinct from excluded.to_hotel_id
                        then null
                        else car_relocations.done_at
                      end;
end;
$$;

/**
 * Drop the override, so the night's row for this car goes back to whatever the
 * derivation says.
 *
 * A ticked-off move that is cleared does NOT walk `cars.stationed_at` back. The
 * car was driven; deleting the note about it does not undrive it. Correcting a
 * station that is genuinely wrong is admin_set_car_station()'s job, on the car's
 * own record, where it is an explicit act rather than a side effect.
 */
create or replace function public.admin_clear_relocation(p_night date, p_car uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  delete from public.car_relocations
   where night_of = p_night and car_id = p_car;
end;
$$;

/**
 * Tick a move off, and move the car with it — one statement pair in one
 * transaction, so a sheet that says the car is at Belvedere and a fleet list
 * that says it is at Μικρή Πόλη cannot both be true.
 *
 * `p_to` is supplied by the caller because a DERIVED move has no row yet: the
 * destination only exists in the derivation until the moment it is confirmed.
 * That trusts the admin with a hotel id, which costs nothing — admin_set_relocation()
 * already lets them name any hotel they like, so there is no privilege here
 * that they did not already hold.
 */
create or replace function public.admin_complete_relocation(
  p_night date, p_car uuid, p_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_to is null then
    raise exception using errcode = 'IR104',
      message = 'a completed relocation must name a destination';
  end if;

  insert into public.car_relocations
    (night_of, car_id, to_hotel_id, done_at, decided_by)
  values (p_night, p_car, p_to, now(), auth.uid())
  on conflict (night_of, car_id) do update
    set to_hotel_id = excluded.to_hotel_id,
        done_at     = now(),
        decided_by  = excluded.decided_by,
        updated_at  = now();

  update public.cars
     set stationed_at = p_to,
         updated_at   = now()
   where id = p_car;
end;
$$;

/**
 * Correct a car's station directly, from its own record — for the plates that
 * arrive unplaced and for the ones a trigger could not place (an ad-hoc-hotel
 * return, a car moved without anybody writing it down). p_hotel null unplaces
 * it again, which is the honest answer when nobody knows.
 */
create or replace function public.admin_set_car_station(p_car uuid, p_hotel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  update public.cars
     set stationed_at = p_hotel,
         updated_at   = now()
   where id = p_car;

  if not found then
    raise exception using errcode = 'IR104', message = 'car not found';
  end if;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_set_relocation(date,uuid,uuid)',
    'public.admin_clear_relocation(date,uuid)',
    'public.admin_complete_relocation(date,uuid,uuid)',
    'public.admin_set_car_station(uuid,uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;
