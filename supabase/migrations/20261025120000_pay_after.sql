-- ═════════════════════════════════════════════════════════════════════════════
-- Pay after: a rental out on trust, and the boss settling it later
--
-- docs/01-DECISIONS.md §47. A rep sees one new payment option and nothing
-- else. Everything about the money still owed is the boss's:
--
--   · a guest with an earlier returned rental under the same phone may take the
--     car paying nothing up front;
--   · anyone else pays the 1-day list price in cash first, so a 1-day rental
--     from a first-time guest can never be pay after;
--   · card is always the full amount, so pay after is never card;
--   · the car stays booked / out / returned exactly as any other rental, the
--     exclusion constraint never knows the difference;
--   · the boss settles all or nothing: Paid (cash or card, income on the day
--     he marks it) or Gratis (the rest waived, its own total).
--
-- Gratis is internal bookkeeping only. The rental's Ψηφιακό Πελατολόγιο entry
-- and its fiscal document are untouched by anything here.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.bookings
  add column pay_after      boolean not null default false,
  add column settlement     text check (settlement in ('paid','gratis')),
  add column settled_amount integer check (settled_amount >= 0),
  add column settled_method public.pay_method,
  add column settled_by     uuid references public.profiles,
  add column settled_at     timestamptz;

-- A settlement is all of its columns or none of them, only ever on a pay-after
-- rental, and a Paid one says how the money came in while a Gratis one cannot.
alter table public.bookings add constraint bookings_settlement_shape check (
  (settlement is null
     and settled_amount is null and settled_method is null
     and settled_by is null and settled_at is null)
  or (pay_after
     and settled_amount is not null and settled_by is not null and settled_at is not null
     and (settlement = 'paid') = (settled_method is not null)));

alter table public.bookings drop constraint bookings_block_is_bare;
alter table public.bookings add constraint bookings_block_is_bare check (
  kind = 'rental' or (
    cust_first is null and cust_last is null and cust_phone is null and
    cust_dob is null and cust_email is null and hotel_id is null and
    adhoc_hotel_name is null and
    room_number is null and period_id is null and total is null and
    collected = 0 and pay_method is null and paid = false and not pay_after));

create index bookings_open_pay_after on public.bookings (created_by)
  where pay_after and settlement is null;

-- A rep reads and ticks the option on their own booking. The settlement
-- columns get no grant at all: the admin RPCs below are their only door, for
-- the boss as much as for a rep.
grant select (pay_after) on public.bookings to authenticated;
grant update (pay_after) on public.bookings to authenticated;

/*
 * What a pay-after guest has to hand over before the keys: 0 for a returning
 * guest, the 1-day list price for anyone else, null when pay after is not on
 * offer at all (a first-time guest on a 1-day rental).
 *
 * "Returning" is any earlier rental under the same normalised phone that went
 * out and came back. Read from bookings, not from the consent ledger (§25a),
 * so a guest who never ticked the box still counts.
 *
 * The 1-day price comes from the sheet that priced this booking. A total the
 * boss typed by hand has no sheet, so it falls back to that total per day.
 */
create function app.pay_after_upfront(p_booking public.bookings)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day1  integer;
  -- Not p_booking.cust_phone_e164: inside a BEFORE trigger the generated
  -- column has not been computed yet.
  v_phone text := app.phone_e164(p_booking.cust_phone);
begin
  if v_phone is not null and exists (
    select 1 from public.bookings p
    where p.cust_phone_e164 = v_phone
      and p.id <> p_booking.id
      and p.kind = 'rental'
      and p.status = 'returned')
  then
    return 0;
  end if;

  if p_booking.days is null or p_booking.days < 2 then
    return null;
  end if;

  select pr.total into v_day1
  from public.price_rows pr
  where pr.period_id = p_booking.period_id
    and pr.category_id = p_booking.category_id
    and pr.days = 1;

  return coalesce(v_day1, ceil(p_booking.total::numeric / p_booking.days)::integer);
end;
$$;

revoke all on function app.pay_after_upfront(public.bookings) from public;

/*
 * The gate. Runs after bookings_guard (name order) has frozen what a rep may
 * not touch, and only up to and including the pickup: once a car is out the
 * choice is fixed for a rep, and the boss's own later edits are his.
 */
create function app.bookings_enforce_pay_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_upfront integer;
begin
  if new.kind <> 'rental' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'booked' then
    if not app.is_admin() then
      new.pay_after := old.pay_after;
    end if;
    return new;
  end if;

  if not new.pay_after then
    return new;
  end if;

  -- Nothing taken means no method; something taken is cash, never card.
  if new.collected = 0 then
    new.pay_method := null;
  elsif new.pay_method is distinct from 'cash' then
    raise exception using errcode = 'IR123', message = 'pay after is cash or nothing up front';
  end if;

  if new.total is null or new.collected >= new.total then
    raise exception using errcode = 'IR123', message = 'nothing is left to pay after';
  end if;
  new.paid := false;

  v_upfront := app.pay_after_upfront(new);
  if v_upfront is null then
    raise exception using errcode = 'IR124', message = 'a first-time guest pays a 1-day rental in full';
  end if;
  if new.collected < v_upfront then
    raise exception using errcode = 'IR125', message = 'a first-time guest pays the first day up front';
  end if;

  return new;
end;
$$;

revoke all on function app.bookings_enforce_pay_after() from public;

create trigger bookings_pay_after
  before insert or update on public.bookings
  for each row execute function app.bookings_enforce_pay_after();

/*
 * R4 step 7: the one number a rep needs, for the booking in front of them.
 * Null means the option is not on offer. No balance, no other booking, no
 * total of anything (§7).
 */
create function public.pay_after_upfront(p_booking_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_row public.bookings;
begin
  perform app.assert_staff();
  if not app.can_read_booking(p_booking_id) then
    raise exception using errcode = '42501', message = 'not your booking';
  end if;

  select * into v_row from public.bookings where id = p_booking_id and kind = 'rental';
  if not found then
    raise exception using errcode = 'IR112', message = 'no such rental';
  end if;

  return app.pay_after_upfront(v_row);
end;
$$;

revoke all on function public.pay_after_upfront(uuid) from public;
grant execute on function public.pay_after_upfront(uuid) to authenticated, service_role;

/*
 * A14: the boss settles one open balance, all of it, one way.
 * 'paid' needs cash or card; 'gratis' takes no method.
 */
create function public.admin_settle_pay_after(
  p_booking_id uuid,
  p_outcome text,
  p_method public.pay_method default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_outcome is null or p_outcome not in ('paid','gratis')
     or (p_outcome = 'paid') <> coalesce(p_method in ('cash','card'), false)
     or (p_outcome = 'gratis' and p_method is not null) then
    raise exception using errcode = 'IR104', message = 'paid takes cash or card, gratis takes nothing';
  end if;

  update public.bookings b
     set settlement     = p_outcome,
         settled_amount = b.total - b.collected,
         settled_method = p_method,
         settled_by     = auth.uid(),
         settled_at     = now(),
         paid           = (p_outcome = 'paid')
   where b.id = p_booking_id
     and b.kind = 'rental'
     and b.pay_after
     and b.settlement is null
     and b.status in ('out','returned');

  if not found then
    raise exception using errcode = 'IR126', message = 'no open balance on that booking';
  end if;
end;
$$;

revoke all on function public.admin_settle_pay_after(uuid, text, public.pay_method) from public;
grant execute on function public.admin_settle_pay_after(uuid, text, public.pay_method) to authenticated, service_role;

/* A14 and A12: every open pay-after balance, oldest pickup first. Admin only. */
create function public.admin_open_pay_after()
returns table (
  booking_id uuid,
  ref text,
  cust_name text,
  cust_phone text,
  start_date date,
  end_date date,
  status public.booking_status,
  rep_id uuid,
  rep_name text,
  balance integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  return query
    select b.id, b.ref, concat_ws(' ', b.cust_first, b.cust_last), b.cust_phone,
           b.start_date, b.end_date, b.status, b.created_by, p.full_name,
           b.total - b.collected
    from public.bookings b
    join public.profiles p on p.id = b.created_by
    where b.kind = 'rental'
      and b.pay_after
      and b.settlement is null
      and b.status in ('out','returned')
    order by b.start_date, b.ref;
end;
$$;

revoke all on function public.admin_open_pay_after() from public;
grant execute on function public.admin_open_pay_after() to authenticated, service_role;

/*
 * A14: money actually received between two Athens dates, inclusive. Pickup
 * takings count on the pickup day (the same handover the rep's cash in hand
 * is measured by), a later settlement on the day the boss marked it. Gratis
 * is reported apart and is never income.
 */
create function public.admin_money_summary(p_from date, p_to date)
returns table (cash integer, card integer, gratis integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_from is null or p_to is null or p_to < p_from then
    raise exception using errcode = 'IR104', message = 'a period needs a start on or before its end';
  end if;

  return query
    with taken as (
      select b.pay_method as method, b.collected as amount
      from public.bookings b
      join public.handovers h on h.booking_id = b.id and h.kind = 'pickup'
      where b.kind = 'rental'
        and (h.occurred_at at time zone 'Europe/Athens')::date between p_from and p_to
      union all
      select b.settled_method, b.settled_amount
      from public.bookings b
      where b.settlement = 'paid'
        and (b.settled_at at time zone 'Europe/Athens')::date between p_from and p_to
    )
    select
      coalesce((select sum(t.amount) from taken t where t.method = 'cash'), 0)::integer,
      coalesce((select sum(t.amount) from taken t where t.method = 'card'), 0)::integer,
      coalesce((select sum(b.settled_amount) from public.bookings b
                where b.settlement = 'gratis'
                  and (b.settled_at at time zone 'Europe/Athens')::date between p_from and p_to), 0)::integer;
end;
$$;

revoke all on function public.admin_money_summary(date, date) from public;
grant execute on function public.admin_money_summary(date, date) to authenticated, service_role;
