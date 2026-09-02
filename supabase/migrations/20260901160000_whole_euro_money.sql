-- ═════════════════════════════════════════════════════════════════════════════
-- 0029 · Money is whole euros, never cents
--
-- Every money column in this schema was integer cents (total_cents,
-- collected_cents, charge_cents, amount_cents, price_extra_day.cents),
-- converted to/from euros only at the UI boundary. The owner's rule going
-- forward: money is a whole euro integer everywhere, full stop — no cents
-- column, no fractional euro, no *100/÷100 conversion anywhere in the stack.
--
-- Dev/local database only at the time of this migration, so existing rows
-- are converted in place (rounded to the nearest euro) rather than requiring
-- a reseed.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── price_rows ──────────────────────────────────────────────────────────────
alter table public.price_rows rename column total_cents to total;
update public.price_rows set total = round(total / 100.0)::integer;
alter table public.price_rows rename constraint price_rows_total_cents_check to price_rows_total_check;

-- ── price_extra_day ─────────────────────────────────────────────────────────
alter table public.price_extra_day rename column cents to price;
update public.price_extra_day set price = round(price / 100.0)::integer;
alter table public.price_extra_day rename constraint price_extra_day_cents_check to price_extra_day_price_check;

-- ── bookings ─────────────────────────────────────────────────────────────────
alter table public.bookings rename column total_cents to total;
alter table public.bookings rename column collected_cents to collected;
update public.bookings set total = round(total / 100.0)::integer where total is not null;
update public.bookings set collected = round(collected / 100.0)::integer;
alter table public.bookings rename constraint bookings_total_cents_check to bookings_total_check;
alter table public.bookings rename constraint bookings_collected_cents_check to bookings_collected_check;

-- ── exceptions ───────────────────────────────────────────────────────────────
alter table public.exceptions rename column charge_cents to charge;
update public.exceptions set charge = round(charge / 100.0)::integer where charge is not null;
alter table public.exceptions rename constraint exceptions_charge_cents_check to exceptions_charge_check;

comment on column public.exceptions.charge is
  'Set by the admin only, through public.admin_resolve_exception(). Not granted to authenticated.';

-- ── cash_handovers ───────────────────────────────────────────────────────────
alter table public.cash_handovers rename column amount_cents to amount;
update public.cash_handovers set amount = round(amount / 100.0)::integer;
alter table public.cash_handovers rename constraint cash_handovers_amount_cents_check to cash_handovers_amount_check;

-- ── functions: in-place replace (body-only change, no OUT-column rename) ────

create or replace function public.my_cash_in_hand()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_total integer;
begin
  perform app.assert_staff();

  if auth.uid() is null then
    return 0;
  end if;

  select coalesce(sum(b.collected), 0)
    into v_total
  from public.bookings b
  join public.handovers h
    on h.booking_id = b.id and h.kind = 'pickup'
  left join public.cash_handovers ch
    on ch.id = b.cash_handover_id
  where b.created_by = auth.uid()
    and b.kind = 'rental'
    and b.pay_method = 'cash'
    and (b.cash_handover_id is null or ch.confirmed_by is null)
    and (h.occurred_at at time zone 'Europe/Athens')::date = app.today()
  ;

  return v_total;
end;
$$;

create or replace function public.my_cash_ready_to_hand_over()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_total integer;
begin
  perform app.assert_staff();

  if auth.uid() is null then
    return 0;
  end if;

  select coalesce(sum(b.collected), 0)
    into v_total
  from public.bookings b
  join public.handovers h
    on h.booking_id = b.id and h.kind = 'pickup'
  where b.created_by = auth.uid()
    and b.kind = 'rental'
    and b.pay_method = 'cash'
    and b.cash_handover_id is null
    and (h.occurred_at at time zone 'Europe/Athens')::date = app.today();

  return v_total;
end;
$$;

-- ── functions: IN-parameter rename requires drop + recreate too ─────────────
-- (Postgres refuses CREATE OR REPLACE across a parameter rename, in or out.)

drop function public.admin_set_booking_price(uuid, integer);

create function public.admin_set_booking_price(p_booking_id uuid, p_total integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_total is null or p_total < 0 then
    raise exception using errcode = 'IR104', message = 'price must be zero or more euros';
  end if;

  update public.bookings
     set total = p_total
   where id = p_booking_id and kind = 'rental';

  if not found then
    raise exception using errcode = 'IR112', message = 'booking not found';
  end if;
end;
$$;

revoke all on function public.admin_set_booking_price(uuid, integer) from public;
grant execute on function public.admin_set_booking_price(uuid, integer) to authenticated, service_role;

drop function public.admin_resolve_exception(uuid, integer, text);

create function public.admin_resolve_exception(
  p_id uuid,
  p_charge integer,
  p_resolution text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_charge is not null and p_charge < 0 then
    raise exception using errcode = 'IR104', message = 'charge must be zero or more euros';
  end if;

  update public.exceptions
     set charge      = p_charge,
         resolution   = nullif(left(coalesce(p_resolution, ''), 2000), ''),
         resolved_by  = auth.uid(),
         resolved_at  = now()
   where id = p_id;

  if not found then
    raise exception using errcode = 'IR112', message = 'exception not found';
  end if;
end;
$$;

revoke all on function public.admin_resolve_exception(uuid, integer, text) from public;
grant execute on function public.admin_resolve_exception(uuid, integer, text) to authenticated, service_role;

-- ── functions: OUT-column rename requires drop + recreate ───────────────────

drop function public.quote(uuid, date, date);

create function public.quote(
  p_category_id uuid,
  p_start date,
  p_end date
)
returns table (days integer, period_id uuid, total integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days      integer;
  v_periods   uuid[];
  v_period    uuid;
  v_total     integer;
  v_seven     integer;
  v_extra     integer;
begin
  perform app.assert_staff();

  if p_category_id is null or p_start is null or p_end is null then
    raise exception using errcode = 'IR104', message = 'quote() needs a category and both dates';
  end if;

  if not exists (select 1 from public.categories c where c.id = p_category_id) then
    raise exception using errcode = 'IR106', message = 'unknown category';
  end if;

  v_days := app.rental_days(p_start, p_end);

  if v_days < 1 then
    raise exception using errcode = 'IR104', message = 'quote() range ends before it starts';
  end if;

  select array_agg(pp.id)
    into v_periods
  from public.pricing_periods pp
  where daterange(pp.start_date, pp.end_date, '[]') @> p_start;

  if v_periods is null then
    raise exception using errcode = 'IR100',
      message = 'no pricing period covers the pickup date';
  end if;

  if array_length(v_periods, 1) > 1 then
    raise exception using errcode = 'IR101',
      message = 'more than one pricing period covers the pickup date';
  end if;

  v_period := v_periods[1];

  if v_days <= 7 then
    select pr.total into v_total
    from public.price_rows pr
    where pr.period_id = v_period
      and pr.category_id = p_category_id
      and pr.days = v_days;

    if v_total is null then
      raise exception using errcode = 'IR102',
        message = 'no price for that period, category and duration';
    end if;
  else
    select pr.total into v_seven
    from public.price_rows pr
    where pr.period_id = v_period
      and pr.category_id = p_category_id
      and pr.days = 7;

    if v_seven is null then
      raise exception using errcode = 'IR102',
        message = 'no 7-day price for that period and category';
    end if;

    select ped.price into v_extra
    from public.price_extra_day ped
    where ped.period_id = v_period
      and ped.category_id = p_category_id;

    if v_extra is null then
      raise exception using errcode = 'IR103',
        message = 'no extra-day rate for that period and category';
    end if;

    v_total := v_seven + (v_days - 7) * v_extra;
  end if;

  return query select v_days, v_period, v_total;
end;
$$;

comment on function public.quote(uuid, date, date) is
  'One number for the booking in front of the rep. The price tables themselves are never shipped to a client.';

revoke all on function public.quote(uuid, date, date) from public;
grant execute on function public.quote(uuid, date, date) to authenticated, service_role;

drop function public.my_hand_over_cash();

create function public.my_hand_over_cash()
returns table (handover_id uuid, amount integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_ids      uuid[];
  v_total    integer;
  v_handover uuid;
begin
  perform app.assert_staff();

  if v_actor is null then
    raise exception using errcode = 'IR001', message = 'not authorised';
  end if;

  select array_agg(b.id), coalesce(sum(b.collected), 0)
    into v_ids, v_total
  from public.bookings b
  join public.handovers h
    on h.booking_id = b.id and h.kind = 'pickup'
  where b.created_by = v_actor
    and b.kind = 'rental'
    and b.pay_method = 'cash'
    and b.cash_handover_id is null
    and (h.occurred_at at time zone 'Europe/Athens')::date = app.today();

  if v_ids is null or v_total <= 0 then
    raise exception using errcode = 'IR114', message = 'nothing to hand over';
  end if;

  insert into public.cash_handovers (rep_id, amount)
  values (v_actor, v_total)
  returning id into v_handover;

  update public.bookings
     set cash_handover_id = v_handover
   where id = any (v_ids);

  return query select v_handover, v_total;
end;
$$;

comment on function public.my_hand_over_cash() is
  'Hands over the calling rep''s own cash in hand for today, in one movement. Takes no amount and no booking ids: both are read from the same predicate my_cash_in_hand() reports on (docs/01-DECISIONS.md §7).';

revoke all on function public.my_hand_over_cash() from public;
grant execute on function public.my_hand_over_cash() to authenticated, service_role;

drop function public.admin_exception_detail(uuid);

create function public.admin_exception_detail(p_id uuid)
returns table (id uuid, booking_id uuid, type public.exception_type, detail text,
               raised_by uuid, raised_at timestamptz, resolved_by uuid,
               resolved_at timestamptz, charge integer, resolution text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();
  return query
  select e.id, e.booking_id, e.type, e.detail, e.raised_by, e.raised_at,
         e.resolved_by, e.resolved_at, e.charge, e.resolution
  from public.exceptions e
  where e.id = p_id;
end;
$$;

revoke all on function public.admin_exception_detail(uuid) from public;
grant execute on function public.admin_exception_detail(uuid) to authenticated, service_role;

drop function public.admin_pending_cash_handovers();

create function public.admin_pending_cash_handovers()
returns table (
  id uuid,
  rep_id uuid,
  rep_name text,
  amount integer,
  handed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  return query
    select ch.id, ch.rep_id, p.full_name, ch.amount, ch.handed_at
    from public.cash_handovers ch
    join public.profiles p on p.id = ch.rep_id
    where ch.confirmed_by is null
    order by ch.handed_at asc;
end;
$$;

comment on function public.admin_pending_cash_handovers() is
  'A12: every cash_handovers receipt no admin has confirmed yet, oldest first. Admin only.';

revoke all on function public.admin_pending_cash_handovers() from public;
grant execute on function public.admin_pending_cash_handovers() to authenticated, service_role;
