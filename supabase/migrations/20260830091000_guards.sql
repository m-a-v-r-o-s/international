-- ═════════════════════════════════════════════════════════════════════════════
-- 0010 · Write guards and audit
--
-- RLS decides which ROWS you may touch. These triggers decide which FIELDS and
-- which TRANSITIONS, because a policy cannot compare OLD to NEW. Together they
-- are why a rep POSTing `total_cents` or `created_by` gets those fields
-- ignored rather than applied — the guard is in the database, not in a route
-- handler that someone might one day forget to write.
--
--   IR107  car is archived
--   IR108  booking is closed to this actor
--   IR109  status transition not allowed for this actor
--   IR110  a rep may not shorten a rental in progress
--   IR111  a swap car must be in the same category
--   IR120  a driver on this booking fails the eligibility rules
--   IR121  a pickup needs at least one driver on the booking
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch     before update on public.profiles
  for each row execute function app.touch_updated_at();
create trigger cars_touch         before update on public.cars
  for each row execute function app.touch_updated_at();
create trigger app_settings_touch before update on public.app_settings
  for each row execute function app.touch_updated_at();

-- ── Bookings ────────────────────────────────────────────────────────────────
create or replace function app.bookings_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin  boolean := app.is_admin();
  v_actor     uuid    := auth.uid();
  v_category  uuid;
  v_old_cat   uuid;
  v_period    uuid;
  v_total     integer;
  v_reprice   boolean := false;
begin
  -- ── INSERT ──────────────────────────────────────────────────────────────
  if tg_op = 'INSERT' then
    if not v_is_admin then
      -- A rep creates plain rentals, as themselves, in 'booked', at the price
      -- the server works out. Everything else they might send is dropped here.
      new.kind            := 'rental';
      new.status          := 'booked';
      new.created_by      := coalesce(v_actor, new.created_by);
      new.block_reason    := null;
      new.period_id       := null;
      new.days            := null;
      new.total_cents     := null;
      new.collected_cents := 0;
      new.pay_method      := null;
      new.paid            := false;
      new.returned_at     := null;
      new.cash_handover_id := null;
    end if;

    if new.kind = 'block' then
      new.status := 'blocked';
    end if;

    if new.ref is null or new.ref = '' then
      new.ref := app.next_booking_ref();
    end if;

    if exists (select 1 from public.cars c
               where c.id = new.car_id and c.archived_at is not null) then
      raise exception using errcode = 'IR107', message = 'car is archived';
    end if;

    if new.kind = 'rental' then
      new.category_id := app.category_of_car(new.car_id);
      new.days := app.rental_days(new.start_date, new.end_date);

      -- The price comes from the engine. An admin may type a total instead —
      -- that is the only way a price is ever set by hand, and it is audited.
      if new.total_cents is null then
        select q.period_id, q.total_cents into v_period, v_total
        from public.quote(new.category_id, new.start_date, new.end_date) q;
        new.period_id   := v_period;
        new.total_cents := v_total;
      end if;
    else
      new.category_id := null;
      new.days        := null;
    end if;

    return new;
  end if;

  -- ── UPDATE ──────────────────────────────────────────────────────────────
  new.id         := old.id;
  new.ref        := old.ref;
  new.kind       := old.kind;
  new.created_at := old.created_at;
  new.updated_at := now();

  if not v_is_admin then
    new.created_by       := old.created_by;
    new.block_reason     := old.block_reason;
    new.eligibility_override_by := old.eligibility_override_by;
    new.eligibility_override_at := old.eligibility_override_at;
    new.period_id        := old.period_id;
    new.total_cents      := old.total_cents;
    new.cash_handover_id := old.cash_handover_id;

    -- Once a rental is closed it is the boss's business, not the rep's.
    if old.status in ('returned','cancelled','no_show','blocked') then
      raise exception using errcode = 'IR108', message = 'booking is closed';
    end if;

    if old.status = 'out' then
      -- After pickup a rep may do exactly three things: extend the return date,
      -- swap to another car in the same category as part of that extension, and
      -- process the return (docs/01-DECISIONS.md §18).
      if new.status not in ('out','returned') then
        raise exception using errcode = 'IR109', message = 'transition not allowed';
      end if;

      if new.end_date < old.end_date then
        raise exception using errcode = 'IR110', message = 'a rental in progress cannot be shortened';
      end if;

      if new.car_id is distinct from old.car_id
         and app.category_of_car(new.car_id) is distinct from old.category_id then
        raise exception using errcode = 'IR111', message = 'swap car must be in the same category';
      end if;

      new.start_date      := old.start_date;
      new.hotel_id        := old.hotel_id;
      new.room_number     := old.room_number;
      new.cust_first      := old.cust_first;
      new.cust_last       := old.cust_last;
      new.cust_phone      := old.cust_phone;
      new.cust_dob        := old.cust_dob;
      new.pickup_at       := old.pickup_at;
      new.collected_cents := old.collected_cents;
      new.pay_method      := old.pay_method;
      new.paid            := old.paid;
    else
      -- Before pickup: edit anything on the booking, or cancel it.
      if new.status not in ('booked','out','cancelled','no_show') then
        raise exception using errcode = 'IR109', message = 'transition not allowed';
      end if;
    end if;
  end if;

  if new.status = 'returned' and new.returned_at is null then
    new.returned_at := now();
  end if;

  -- ── The hard block ──────────────────────────────────────────────────────
  -- A failing driver cannot be picked up (docs/01-DECISIONS.md §11). This sits
  -- on the booked → out transition rather than in the UI, so there is no route
  -- handler, no screen and no direct API call that can get around it. It
  -- applies to the admin too: the way past it is
  -- public.admin_override_eligibility(), which records the override and raises
  -- it as an exception for the boss.
  if new.kind = 'rental'
     and new.status = 'out' and old.status <> 'out'
     and new.eligibility_override_at is null then
    perform app.assert_drivers_eligible(new.id, new.category_id, new.start_date, new.end_date);
  end if;

  if new.car_id is distinct from old.car_id
     and exists (select 1 from public.cars c
                 where c.id = new.car_id and c.archived_at is not null) then
    raise exception using errcode = 'IR107', message = 'car is archived';
  end if;

  if new.kind = 'rental' then
    v_reprice := (new.start_date is distinct from old.start_date)
              or (new.end_date   is distinct from old.end_date)
              or (new.car_id     is distinct from old.car_id);

    new.days := app.rental_days(new.start_date, new.end_date);

    if new.car_id is distinct from old.car_id then
      new.category_id := app.category_of_car(new.car_id);
    end if;

    -- Re-price when the shape of the rental changed — including an extension,
    -- which still uses the ORIGINAL pickup date's period. If an admin typed a
    -- new total themselves, theirs stands.
    if v_reprice and new.total_cents is not distinct from old.total_cents then
      select q.period_id, q.total_cents into v_period, v_total
      from public.quote(new.category_id, new.start_date, new.end_date) q;
      new.period_id   := v_period;
      new.total_cents := v_total;
    end if;
  end if;

  return new;
end;
$$;

create or replace function app.category_of_car(p_car_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cm.category_id
  from public.cars c
  join public.car_models cm on cm.id = c.model_id
  where c.id = p_car_id
$$;

-- Every driver on the booking, not just the main one: an additional driver is
-- free of charge but is still a driver.
create or replace function app.assert_drivers_eligible(
  p_booking_id uuid,
  p_category_id uuid,
  p_start date,
  p_end date
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r        record;
  v_ok     boolean;
  v_fails  text[];
  v_count  integer := 0;
begin
  for r in
    select d.dob, d.licence_issued_on, d.licence_expires_on
    from public.booking_drivers d
    where d.booking_id = p_booking_id
  loop
    v_count := v_count + 1;

    select e.ok, e.failures into v_ok, v_fails
    from public.check_eligibility(
      p_category_id, r.dob, r.licence_issued_on, r.licence_expires_on, p_start, p_end) e;

    if not v_ok then
      raise exception using
        errcode = 'IR120',
        message = 'driver not eligible',
        detail  = array_to_string(v_fails, ',');
    end if;
  end loop;

  if v_count = 0 then
    raise exception using errcode = 'IR121', message = 'no driver recorded for this booking';
  end if;
end;
$$;

create trigger bookings_guard
  before insert or update on public.bookings
  for each row execute function app.bookings_before_write();

-- ── Audit ───────────────────────────────────────────────────────────────────
-- Actor, entity, before, after, timestamp — on every write, permanently
-- (docs/01-DECISIONS.md §19). Licence numbers, image paths and password/PIN
-- hashes are stripped on the way in: the log is for accountability, not a
-- second copy of the personal data.
create or replace function app.audit_redact(p_row jsonb)
returns jsonb
language sql
immutable
as $$
  select p_row - 'pin_hash'
                - 'licence_number'
                - 'front_image_path'
                - 'back_image_path'
                - 'keys'
$$;

create or replace function app.audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_id     uuid;
begin
  if tg_op = 'INSERT' then
    v_after := app.audit_redact(to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    v_before := app.audit_redact(to_jsonb(old));
    v_after  := app.audit_redact(to_jsonb(new));
    if v_before = v_after then
      return null;   -- an update that changed nothing is not an event
    end if;
  else
    v_before := app.audit_redact(to_jsonb(old));
  end if;

  begin
    v_id := coalesce(v_after->>'id', v_before->>'id')::uuid;
  exception when others then
    v_id := null;    -- composite-key tables (price_rows) have no single id
  end;

  insert into public.audit_log (actor_id, entity, entity_id, action, before, after)
  values (auth.uid(), tg_table_name, v_id, lower(tg_op), v_before, v_after);

  return null;
end;
$$;

create trigger audit_bookings        after insert or update or delete on public.bookings
  for each row execute function app.audit();
create trigger audit_cars            after insert or update or delete on public.cars
  for each row execute function app.audit();
create trigger audit_car_models      after insert or update or delete on public.car_models
  for each row execute function app.audit();
create trigger audit_categories      after insert or update or delete on public.categories
  for each row execute function app.audit();
create trigger audit_pricing_periods after insert or update or delete on public.pricing_periods
  for each row execute function app.audit();
create trigger audit_price_rows      after insert or update or delete on public.price_rows
  for each row execute function app.audit();
create trigger audit_price_extra_day after insert or update or delete on public.price_extra_day
  for each row execute function app.audit();
create trigger audit_profiles        after insert or update or delete on public.profiles
  for each row execute function app.audit();
create trigger audit_hotels          after insert or update or delete on public.hotels
  for each row execute function app.audit();
create trigger audit_hotel_reps      after insert or update or delete on public.hotel_reps
  for each row execute function app.audit();
create trigger audit_booking_drivers after insert or update or delete on public.booking_drivers
  for each row execute function app.audit();
create trigger audit_exceptions      after insert or update or delete on public.exceptions
  for each row execute function app.audit();
create trigger audit_handovers       after insert or update or delete on public.handovers
  for each row execute function app.audit();
create trigger audit_cash_handovers  after insert or update or delete on public.cash_handovers
  for each row execute function app.audit();
create trigger audit_app_settings    after insert or update or delete on public.app_settings
  for each row execute function app.audit();
