-- ─────────────────────────────────────────────────────────────────────────────
-- Recycle bin: the boss's deletes, restorable for 30 days
--
-- No new table and no deleted_at column. app.audit() already writes the whole
-- row into audit_log on every delete, and a cascade (a sheet's prices and date
-- ranges, a hotel's rep assignments, a car's relocations) is logged in the
-- same transaction, so it shares the parent's `at` and actor. That group IS
-- the bin entry: restoring re-inserts every row of it, parent first. Keeping
-- the deletes real means no query anywhere has to learn to skip binned rows.
--
-- Only what the admin screens delete by hand is binnable: hotels, cars, price
-- sheets, a sheet's date ranges and car blocks. Customer erasure and the
-- licence purge are GDPR deletes and must stay gone, so they are not listed.
--
-- 30 days is a filter, not a sweep: audit_log is permanent (§19) anyway.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_recycle_bin()
returns table (id bigint, entity text, entity_id uuid, row_data jsonb, at timestamptz, actor_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  return query
  select b.id, b.entity, b.entity_id, b.before, b.at, p.full_name
  from (
    -- Latest delete per row: restored then deleted again shows once.
    select distinct on (l.entity_id) l.*
    from public.audit_log l
    where l.action = 'delete'
      and l.at > now() - interval '30 days'
      and (l.entity in ('hotels', 'cars', 'pricing_periods', 'pricing_period_ranges')
           or (l.entity = 'bookings' and l.before->>'kind' = 'block'))
      -- A range that went with its whole sheet comes back with the sheet.
      and not (l.entity = 'pricing_period_ranges' and exists (
        select 1 from public.audit_log s
        where s.entity = 'pricing_periods' and s.action = 'delete'
          and s.at = l.at and s.actor_id is not distinct from l.actor_id))
    order by l.entity_id, l.at desc
  ) b
  left join public.profiles p on p.id = b.actor_id
  -- Already restored: the row is back.
  where not case b.entity
    when 'hotels' then exists (select 1 from public.hotels x where x.id = b.entity_id)
    when 'cars' then exists (select 1 from public.cars x where x.id = b.entity_id)
    when 'pricing_periods' then exists (select 1 from public.pricing_periods x where x.id = b.entity_id)
    when 'pricing_period_ranges' then exists (select 1 from public.pricing_period_ranges x where x.id = b.entity_id)
    else exists (select 1 from public.bookings x where x.id = b.entity_id)
  end
  order by b.at desc;
end;
$$;

create or replace function public.admin_restore_deleted(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root public.audit_log;
  v_row  record;
  v_cols text;
begin
  perform app.assert_admin();

  select l.* into v_root from public.audit_log l
  where l.id = p_id
    and exists (select 1 from public.admin_recycle_bin() b where b.id = p_id);
  if not found then
    raise exception using errcode = 'IR112', message = 'not in the recycle bin';
  end if;

  -- Parents before children, so every foreign key has something to point at.
  for v_row in
    select l.entity, l.before from public.audit_log l
    where l.action = 'delete' and l.at = v_root.at
      and l.actor_id is not distinct from v_root.actor_id
      and l.entity in ('hotels', 'hotel_reps', 'cars', 'car_relocations', 'bookings',
                       'pricing_periods', 'pricing_period_ranges', 'price_rows', 'price_extra_day')
    order by case l.entity
      when 'hotels' then 0 when 'pricing_periods' then 0 when 'cars' then 1 when 'bookings' then 2
      else 3 end, l.id
  loop
    -- Generated columns (bookings.cust_phone_e164) recompute themselves.
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
      from pg_catalog.pg_attribute a
     where a.attrelid = ('public.' || quote_ident(v_row.entity))::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
                   v_row.entity, v_cols, v_cols, v_row.entity)
      using v_row.before;
  end loop;

  -- Deleting a hotel unplaced the cars based there (ON DELETE SET NULL). Put
  -- them back, unless a return has placed them somewhere since.
  update public.cars c
     set stationed_at = (l.before->>'stationed_at')::uuid
    from public.audit_log l
   where l.entity = 'cars' and l.action = 'update' and l.at = v_root.at
     and l.actor_id is not distinct from v_root.actor_id
     and l.after->>'stationed_at' is null and l.before->>'stationed_at' is not null
     and c.id = l.entity_id and c.stationed_at is null;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_recycle_bin()',
    'public.admin_restore_deleted(bigint)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;
