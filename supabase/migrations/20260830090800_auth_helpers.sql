-- ─────────────────────────────────────────────────────────────────────────────
-- 0008 · Who is asking?
--
-- These are SECURITY DEFINER on purpose. A rep can only read their own row in
-- `profiles`, so a policy that inspected `profiles` directly would recurse into
-- the very policy it is trying to evaluate. Each function reports on the caller
-- and nobody else, so it leaks nothing.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.current_role_name()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.active
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'admin' and p.active from public.profiles p where p.id = auth.uid()),
    false)
$$;

create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.active from public.profiles p where p.id = auth.uid()),
    false)
$$;

-- The hotels this rep is stationed at or covers. Drives the "both the creating
-- rep and the hotel's rep can see it" rule (docs/01-DECISIONS.md §8).
create or replace function app.my_hotel_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(hr.hotel_id), '{}'::uuid[])
  from public.hotel_reps hr
  where hr.profile_id = auth.uid()
$$;

-- Readability of ONE booking, in one place, so the rule cannot drift between
-- the policy, a route handler and a report.
--   · admin sees everything
--   · a rep sees a RENTAL they created, or one belonging to a hotel they cover
--   · a rep never sees a BLOCK at all — blocks reach them only through
--     availability(), as anonymous occupied dates
create or replace function app.can_read_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.is_admin() then exists (select 1 from public.bookings b where b.id = p_booking_id)
    else exists (
      select 1
      from public.bookings b
      where b.id = p_booking_id
        and b.kind = 'rental'
        and (b.created_by = auth.uid() or b.hotel_id = any (app.my_hotel_ids()))
    )
  end
$$;

grant execute on function app.is_admin() to authenticated, service_role;
grant execute on function app.is_staff() to authenticated, service_role;
grant execute on function app.current_role_name() to authenticated, service_role;
grant execute on function app.my_hotel_ids() to authenticated, service_role;
grant execute on function app.can_read_booking(uuid) to authenticated, service_role;

-- Guard for the SECURITY DEFINER RPCs. A logged-in caller must be active staff.
-- A caller with no JWT at all can only be the service role or one of our own
-- triggers — `anon` is never granted EXECUTE on any of them.
create or replace function app.assert_staff()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not app.is_staff() then
    raise exception using errcode = 'IR001', message = 'not authorised';
  end if;
end;
$$;

create or replace function app.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception using errcode = 'IR001', message = 'not authorised';
  end if;
end;
$$;

grant execute on function app.assert_staff() to authenticated, service_role;
grant execute on function app.assert_admin() to authenticated, service_role;
