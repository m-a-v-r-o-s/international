-- ─────────────────────────────────────────────────────────────────────────────
-- Price sheets: any number of date ranges per sheet, and a whole-sheet adjustment
--
-- The client thinks in named price sheets ("Τιμοκατάλογος 3"), and one sheet
-- can apply in several separate stretches (say May and October). Copying the
-- sheet per stretch would let the copies drift the first time one is edited,
-- so the dates move off the sheet into their own table: one sheet, many
-- ranges, one set of prices. A sheet with no ranges is a draft that quote()
-- never picks, so a price list can be entered before its dates are known.
--
-- And the owner wants "+€5 on everything" as one action rather than 88 edits.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.pricing_period_ranges (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.pricing_periods on delete cascade,
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date),
  -- One date, one sheet, across every season. The old per-season exclusion let
  -- two seasons claim the same calendar day, and quote() then failed every
  -- booking on it with IR101; refusing the save is the better place to say so.
  constraint pricing_period_ranges_no_overlap
    exclude using gist (daterange(start_date, end_date, '[]') with &&)
);

create index on public.pricing_period_ranges (period_id);

insert into public.pricing_period_ranges (period_id, start_date, end_date)
select id, start_date, end_date from public.pricing_periods;

-- The exclusion constraint has to go by name; the CHECK and the range index
-- go with the columns.
alter table public.pricing_periods
  drop constraint pricing_periods_season_year_daterange_excl,
  drop column start_date,
  drop column end_date;

alter table public.pricing_period_ranges enable row level security;
grant select, insert, update, delete on public.pricing_period_ranges to authenticated;
create policy pricing_period_ranges_admin on public.pricing_period_ranges
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

create trigger audit_pricing_period_ranges after insert or update or delete on public.pricing_period_ranges
  for each row execute function app.audit();

-- Same body as 20260901160000_whole_euro_money.sql, except that the pickup
-- date is looked up in the ranges rather than on the sheet.
create or replace function public.quote(
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

  select array_agg(distinct r.period_id)
    into v_periods
  from public.pricing_period_ranges r
  where daterange(r.start_date, r.end_date, '[]') @> p_start;

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

/**
 * Add p_delta whole euros (negative to lower) to every number on one sheet:
 * each 1–7 day total and each extra-day rate. One statement each, one
 * transaction, so either the whole sheet moves or none of it does. A result
 * below zero refuses the lot rather than clamping some cells.
 *
 * SECURITY INVOKER: the admin-only RLS on both tables is the access control,
 * assert_admin() just makes a refusal loud instead of a silent no-op.
 */
create function public.adjust_period_prices(p_period_id uuid, p_delta integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_period_id is null or p_delta is null or p_delta = 0 then
    raise exception using errcode = 'IR104', message = 'adjust_period_prices() needs a sheet and a non-zero amount';
  end if;

  if exists (select 1 from public.price_rows where period_id = p_period_id and total + p_delta < 0)
     or exists (select 1 from public.price_extra_day where period_id = p_period_id and price + p_delta < 0) then
    raise exception using errcode = 'IR104', message = 'that would take a price below zero';
  end if;

  update public.price_rows set total = total + p_delta where period_id = p_period_id;
  update public.price_extra_day set price = price + p_delta where period_id = p_period_id;
end;
$$;

revoke execute on function public.adjust_period_prices(uuid, integer) from public, anon;
grant execute on function public.adjust_period_prices(uuid, integer) to authenticated;
