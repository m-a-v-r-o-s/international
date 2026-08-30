-- ═════════════════════════════════════════════════════════════════════════════
-- 0009 · The two engines
--
-- Everything else in this app is CRUD. These are where correctness lives, and
-- both run server-side only: the client never computes a price and never
-- decides availability.
--
-- Error codes raised here (mapped to translated messages in the app, never
-- shown raw):
--   IR001  not authorised
--   IR100  no pricing period covers the pickup date
--   IR101  more than one pricing period covers the pickup date
--   IR102  no price row for that period / category / duration
--   IR103  no extra-day rate for that period / category
--   IR104  invalid date range
--   IR105  requested range too large
--   IR106  unknown category
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Engine 1 · Availability ─────────────────────────────────────────────────
-- The ONLY channel through which a rep learns that a car is taken.
--
-- Returns car ids and occupied dates. No booking id, no status, no kind, no
-- rep, no hotel, no customer, no price, no times, no reason. A block placed by
-- the admin and another rep's booking come back identical, because they are
-- identical here — that is the requirement, not an oversight
-- (docs/03-SECURITY.md, rule 2). If a future feature "just needs" one more
-- column in this result, it does not.
create or replace function public.availability(from_date date, to_date date)
returns table (car_id uuid, occupied_dates date[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_staff();

  if from_date is null or to_date is null then
    raise exception using errcode = 'IR104', message = 'availability() needs both dates';
  end if;

  if to_date < from_date then
    raise exception using errcode = 'IR104', message = 'availability() range ends before it starts';
  end if;

  -- A year and a day is more than any real lookup, and caps the work one
  -- request can ask for.
  if (to_date - from_date) > 366 then
    raise exception using errcode = 'IR105', message = 'availability() range too large';
  end if;

  return query
  select c.id,
         coalesce(
           array_agg(distinct d.day order by d.day) filter (where d.day is not null),
           '{}'::date[])
  from public.cars c
  -- A hold counts while it is 'booked', 'out' or 'blocked' — the same predicate
  -- as the exclusion constraint. 'returned', 'cancelled' and 'no_show' fall out
  -- of it, which is how an early return reopens the remaining dates the moment
  -- the return is processed.
  left join public.bookings b
         on b.car_id = c.id
        and b.status in ('booked','out','blocked')
        and daterange(b.start_date, b.end_date, '[]')
            && daterange(from_date, to_date, '[]')
  -- `b.id is not null` matters: greatest()/least() ignore NULLs, so without it
  -- a car with no hold at all would come back with the entire window listed as
  -- occupied — the worst possible direction for this bug to fail in.
  left join lateral (
    select gs::date as day
    from generate_series(
           greatest(b.start_date, from_date),
           least(b.end_date, to_date),
           interval '1 day') as gs
    where b.id is not null
  ) as d on true
  -- Archived cars leave availability entirely (docs/01-DECISIONS.md §17).
  where c.archived_at is null
  group by c.id;
end;
$$;

comment on function public.availability(date, date) is
  'Car ids and occupied dates for a range. Returns nothing else, by design.';

-- ── Engine 2 · Pricing ──────────────────────────────────────────────────────
--   days   = (end - start) + 1                       -- inclusive
--   period = the period containing the PICKUP date   -- the pickup date decides
--   <= 7   : the total the admin typed
--   >  7   : the 7-day total + (days - 7) x the extra-day rate
--
-- The totals already contain the +€5 first-day premium; the app adds nothing.
-- Baby seats and additional drivers are free and add nothing.
-- If the pickup date sits in no defined period this FAILS. It does not guess and
-- it does not fall back to a neighbouring period.
create or replace function public.quote(
  p_category_id uuid,
  p_start date,
  p_end date
)
returns table (days integer, period_id uuid, total_cents integer)
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

  -- Cross-period rentals are priced entirely by the PICKUP date's period
  -- (docs/01-DECISIONS.md §6). The end date is never consulted for the period.
  select array_agg(pp.id)
    into v_periods
  from public.pricing_periods pp
  where daterange(pp.start_date, pp.end_date, '[]') @> p_start;

  if v_periods is null then
    raise exception using errcode = 'IR100',
      message = 'no pricing period covers the pickup date';
  end if;

  -- Periods cannot overlap within a season, but two seasons could in principle
  -- be defined over the same dates. That is a data error, and guessing which
  -- one to charge would be worse than stopping.
  if array_length(v_periods, 1) > 1 then
    raise exception using errcode = 'IR101',
      message = 'more than one pricing period covers the pickup date';
  end if;

  v_period := v_periods[1];

  if v_days <= 7 then
    select pr.total_cents into v_total
    from public.price_rows pr
    where pr.period_id = v_period
      and pr.category_id = p_category_id
      and pr.days = v_days;

    if v_total is null then
      raise exception using errcode = 'IR102',
        message = 'no price for that period, category and duration';
    end if;
  else
    select pr.total_cents into v_seven
    from public.price_rows pr
    where pr.period_id = v_period
      and pr.category_id = p_category_id
      and pr.days = 7;

    if v_seven is null then
      raise exception using errcode = 'IR102',
        message = 'no 7-day price for that period and category';
    end if;

    select ped.cents into v_extra
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

-- ── Eligibility · a hard block ──────────────────────────────────────────────
-- Minimum ages and the minimum licence-held period are columns on `categories`,
-- editable by the admin. They are never hard-coded in application logic
-- (docs/01-DECISIONS.md §11).
--
-- Returns codes, not sentences: the app translates them. Only the admin can
-- override a failure, and the override is recorded as an exception.
create or replace function public.check_eligibility(
  p_category_id uuid,
  p_dob date,
  p_licence_issued_on date,
  p_licence_expires_on date,
  p_start date,
  p_end date
)
returns table (ok boolean, failures text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min_age    smallint;
  v_min_years  smallint;
  v_failures   text[] := '{}';
begin
  perform app.assert_staff();

  select c.min_driver_age, c.min_licence_years
    into v_min_age, v_min_years
  from public.categories c
  where c.id = p_category_id;

  if v_min_age is null then
    raise exception using errcode = 'IR106', message = 'unknown category';
  end if;

  if p_start is null or p_end is null or p_end < p_start then
    raise exception using errcode = 'IR104', message = 'invalid rental dates';
  end if;

  -- Age is measured on the pickup date: the guest has to be old enough when
  -- they take the car, not by the time they bring it back.
  if p_dob is null then
    v_failures := v_failures || 'dob_missing'::text;
  elsif p_start < (p_dob + make_interval(years => v_min_age)) then
    v_failures := v_failures || 'age'::text;
  end if;

  if p_licence_issued_on is null then
    v_failures := v_failures || 'licence_issue_date_missing'::text;
  elsif p_start < (p_licence_issued_on + make_interval(years => v_min_years)) then
    v_failures := v_failures || 'licence_held'::text;
  end if;

  -- The licence must still be valid on the final day of the rental.
  if p_licence_expires_on is null then
    v_failures := v_failures || 'licence_expiry_missing'::text;
  elsif p_licence_expires_on < p_end then
    v_failures := v_failures || 'licence_expired'::text;
  end if;

  return query select (array_length(v_failures, 1) is null), v_failures;
end;
$$;

-- ── The one aggregate a rep may see ─────────────────────────────────────────
-- Their own cash, collected today, not yet handed over. In Athens time, because
-- a rep's day ends at midnight where they are standing, not in UTC.
-- There is no company figure here, no other rep's figure, and no history.
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

  select coalesce(sum(b.collected_cents), 0)
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

-- Nothing here is reachable without a session: `anon` is granted nothing.
revoke all on function public.availability(date, date) from public;
revoke all on function public.quote(uuid, date, date) from public;
revoke all on function public.check_eligibility(uuid, date, date, date, date, date) from public;
revoke all on function public.my_cash_in_hand() from public;

grant execute on function public.availability(date, date) to authenticated, service_role;
grant execute on function public.quote(uuid, date, date) to authenticated, service_role;
grant execute on function public.check_eligibility(uuid, date, date, date, date, date)
  to authenticated, service_role;
grant execute on function public.my_cash_in_hand() to authenticated, service_role;
