-- ═════════════════════════════════════════════════════════════════════════════
-- 0014 · staff_hotels()
--
-- Gap found building R3 (New booking): docs/03-SECURITY.md's permission matrix
-- explicitly allows a rep to "Create a booking (any hotel)" — a rep covering a
-- shift needs to book against a hotel that is not their own. But the
-- `hotels_select` policy in 0011_rls.sql restricts SELECT on `public.hotels`
-- to `app.is_admin() or id = any(app.my_hotel_ids())`, so a rep cannot see the
-- name of any hotel but their own to choose it from.
--
-- Nothing on `hotels` is sensitive — a name, an area, an address, same
-- information as a business listing — so the fix is the same shape as
-- availability(): a narrow SECURITY DEFINER function that hands every active
-- hotel's name to any signed-in staff member, without loosening the
-- underlying table policy (which still protects `hotel_reps` and the
-- admin-write path). This does not change who may book where; it only lets a
-- rep see the list they were already allowed to book against.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.staff_hotels()
returns table (id uuid, name text, area text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_staff();

  return query
  select h.id, h.name, h.area
  from public.hotels h
  where h.active
  order by h.name;
end;
$$;

comment on function public.staff_hotels() is
  'Every active hotel''s name and area, for any signed-in staff member — needed so a rep can book at a hotel they do not cover (docs/03-SECURITY.md: "Create a booking (any hotel)").';

revoke all on function public.staff_hotels() from public;
grant execute on function public.staff_hotels() to authenticated, service_role;

-- ── rental_days() ────────────────────────────────────────────────────────────
-- R3 (New booking) shows the day count live as the rep edits the pickup and
-- return dates, before a car or category is even chosen — "Mon pickup → Wed
-- return = 3 days" (docs/04-SCREENS.md, R3). Every date calculation in this
-- codebase goes through the database (HANDOFF.md), so this is a one-line
-- public wrapper around the already-audited app.rental_days(), not a second
-- implementation of the inclusive-day rule.
create or replace function public.rental_days(p_start date, p_end date)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_staff();

  if p_start is null or p_end is null or p_end < p_start then
    raise exception using errcode = 'IR104', message = 'invalid date range';
  end if;

  return app.rental_days(p_start, p_end);
end;
$$;

comment on function public.rental_days(date, date) is
  'The inclusive day count for a date range, for the live "N days" display before a category is chosen. The same app.rental_days() the engines and guards use.';

revoke all on function public.rental_days(date, date) from public;
grant execute on function public.rental_days(date, date) to authenticated, service_role;
