-- ═════════════════════════════════════════════════════════════════════════════
-- 0012 · Admin-only RPCs
--
-- An admin holds the same `authenticated` database role as a rep, so a column
-- grant cannot tell the two apart. The handful of fields a rep must never
-- receive are therefore withheld from that role entirely and reached only
-- through these functions, each of which re-checks app.is_admin() itself.
-- Every one of them writes through the audited tables, so the amendment is on
-- the record with actor, before and after.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Blocks ──────────────────────────────────────────────────────────────────
-- Service, repair and write-offs leave availability as blocks. To a rep a block
-- is indistinguishable from another rep's booking, and the reason never leaves
-- this function.
create or replace function public.admin_create_block(
  p_car_id uuid,
  p_start date,
  p_end date,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform app.assert_admin();

  if p_start is null or p_end is null or p_end < p_start then
    raise exception using errcode = 'IR104', message = 'invalid block range';
  end if;

  insert into public.bookings (kind, status, car_id, start_date, end_date,
                               block_reason, created_by)
  values ('block', 'blocked', p_car_id, p_start, p_end,
          nullif(left(coalesce(p_reason, ''), 500), ''), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.admin_update_block(
  p_id uuid,
  p_start date,
  p_end date,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  update public.bookings
     set start_date   = coalesce(p_start, start_date),
         end_date     = coalesce(p_end, end_date),
         block_reason = nullif(left(coalesce(p_reason, ''), 500), '')
   where id = p_id and kind = 'block';

  if not found then
    raise exception using errcode = 'IR112', message = 'block not found';
  end if;
end;
$$;

create or replace function public.admin_delete_block(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();
  delete from public.bookings where id = p_id and kind = 'block';
  if not found then
    raise exception using errcode = 'IR112', message = 'block not found';
  end if;
end;
$$;

create or replace function public.admin_blocks(p_from date, p_to date)
returns table (id uuid, car_id uuid, start_date date, end_date date, block_reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  return query
  select b.id, b.car_id, b.start_date, b.end_date, b.block_reason
  from public.bookings b
  where b.kind = 'block'
    and daterange(b.start_date, b.end_date, '[]') && daterange(p_from, p_to, '[]')
  order by b.start_date;
end;
$$;

-- ── Car notes ───────────────────────────────────────────────────────────────
create or replace function public.admin_car_notes(p_car_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_notes text;
begin
  perform app.assert_admin();
  select c.notes into v_notes from public.cars c where c.id = p_car_id;
  return v_notes;
end;
$$;

create or replace function public.admin_set_car_notes(p_car_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();
  update public.cars set notes = nullif(left(coalesce(p_notes, ''), 2000), '')
   where id = p_car_id;
end;
$$;

-- ── Price amendment ─────────────────────────────────────────────────────────
-- The one way a booking's total is ever changed by hand. Reps cannot discount,
-- override or negotiate (docs/01-DECISIONS.md §6); the boss can, and it lands
-- in the audit log.
create or replace function public.admin_set_booking_price(p_booking_id uuid, p_total_cents integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_total_cents is null or p_total_cents < 0 then
    raise exception using errcode = 'IR104', message = 'price must be zero or more cents';
  end if;

  update public.bookings
     set total_cents = p_total_cents
   where id = p_booking_id and kind = 'rental';

  if not found then
    raise exception using errcode = 'IR112', message = 'booking not found';
  end if;
end;
$$;

-- ── Exceptions ──────────────────────────────────────────────────────────────
-- The boss decides the amount and closes the item. The rep never sees it.
create or replace function public.admin_resolve_exception(
  p_id uuid,
  p_charge_cents integer,
  p_resolution text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_charge_cents is not null and p_charge_cents < 0 then
    raise exception using errcode = 'IR104', message = 'charge must be zero or more cents';
  end if;

  update public.exceptions
     set charge_cents = p_charge_cents,
         resolution   = nullif(left(coalesce(p_resolution, ''), 2000), ''),
         resolved_by  = auth.uid(),
         resolved_at  = now()
   where id = p_id;

  if not found then
    raise exception using errcode = 'IR112', message = 'exception not found';
  end if;
end;
$$;

create or replace function public.admin_exception_detail(p_id uuid)
returns table (id uuid, booking_id uuid, type public.exception_type, detail text,
               raised_by uuid, raised_at timestamptz, resolved_by uuid,
               resolved_at timestamptz, charge_cents integer, resolution text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();
  return query
  select e.id, e.booking_id, e.type, e.detail, e.raised_by, e.raised_at,
         e.resolved_by, e.resolved_at, e.charge_cents, e.resolution
  from public.exceptions e
  where e.id = p_id;
end;
$$;

-- ── Eligibility override ────────────────────────────────────────────────────
-- The only way past the hard block on the booked → out transition. It is
-- recorded on the booking AND raised as an exception, so the boss sees on his
-- own queue what he waved through (docs/01-DECISIONS.md §11 and §14).
create or replace function public.admin_override_eligibility(p_booking_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  update public.bookings
     set eligibility_override_by = auth.uid(),
         eligibility_override_at = now()
   where id = p_booking_id and kind = 'rental';

  if not found then
    raise exception using errcode = 'IR112', message = 'booking not found';
  end if;

  insert into public.exceptions (booking_id, type, detail, raised_by)
  values (p_booking_id, 'eligibility_override',
          nullif(left(coalesce(p_note, ''), 2000), ''), auth.uid());
end;
$$;

-- ── Users ───────────────────────────────────────────────────────────────────
-- `role` and `active` are updatable by no client grant at all, so this is the
-- only path. Reps are deactivated, never deleted, so history stays intact.
create or replace function public.admin_set_user_role(p_profile_id uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_profile_id = auth.uid() then
    raise exception using errcode = 'IR113', message = 'cannot change your own role';
  end if;

  update public.profiles set role = p_role where id = p_profile_id;
end;
$$;

create or replace function public.admin_set_user_active(p_profile_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_profile_id = auth.uid() then
    raise exception using errcode = 'IR113', message = 'cannot deactivate yourself';
  end if;

  update public.profiles set active = coalesce(p_active, true) where id = p_profile_id;
end;
$$;

-- ── Cash ────────────────────────────────────────────────────────────────────
create or replace function public.admin_confirm_cash_handover(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();
  update public.cash_handovers set confirmed_by = auth.uid() where id = p_id;
  if not found then
    raise exception using errcode = 'IR112', message = 'handover not found';
  end if;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_create_block(uuid,date,date,text)',
    'public.admin_update_block(uuid,date,date,text)',
    'public.admin_delete_block(uuid)',
    'public.admin_blocks(date,date)',
    'public.admin_car_notes(uuid)',
    'public.admin_set_car_notes(uuid,text)',
    'public.admin_set_booking_price(uuid,integer)',
    'public.admin_resolve_exception(uuid,integer,text)',
    'public.admin_exception_detail(uuid)',
    'public.admin_override_eligibility(uuid,text)',
    'public.admin_set_user_role(uuid,public.user_role)',
    'public.admin_set_user_active(uuid,boolean)',
    'public.admin_confirm_cash_handover(uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;
