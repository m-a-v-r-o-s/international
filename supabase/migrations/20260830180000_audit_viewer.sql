-- ═════════════════════════════════════════════════════════════════════════════
-- 0022 · A9 · Reading the audit log (docs/04-SCREENS.md A9)
--
-- "Filterable by actor, entity and date. Read-only. Permanent."
--
-- The table has been readable by the admin since 0011 — `grant select on
-- public.audit_log to authenticated` with an app.is_admin() policy — so this
-- migration adds no access. It exists for two reasons, both of which would
-- otherwise be solved worse in TypeScript:
--
--   · DATES. Filtering by day means the boss's day, which ends at midnight in
--     Athens and not at 03:00 local (the reason app.today() exists). PostgREST
--     cannot express `(at at time zone 'Europe/Athens')::date`, so the
--     alternative was converting day boundaries to instants in Node — the same
--     mistake R3's pick-up times deliberately avoid, and one that gets the
--     March and October changeovers wrong in a country that observes both.
--   · THE ACTOR'S NAME. The log stores actor_id and nothing else, by design.
--     Joining profiles here keeps A9 to one query and one round trip.
--
-- WHAT THIS DOES NOT DO, and must never be changed to do: re-join anything
-- app.audit_redact() stripped on the way in. pin_hash, licence_number, the
-- licence image paths, pdf_path, signature_path and photo_path are absent from
-- `before` and `after` because the log is for accountability, not a second
-- index of where the personal data sits. A function that reunited a redacted
-- row with its source would undo that quietly, from the one screen nobody
-- audits. The only thing joined below is the actor's own name.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.admin_audit_log(
  p_actor uuid default null,
  p_entity text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint,
  at timestamptz,
  actor_id uuid,
  actor_name text,
  entity text,
  entity_id uuid,
  action text,
  before jsonb,
  after jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  return query
  select l.id, l.at, l.actor_id, p.full_name, l.entity, l.entity_id, l.action,
         l.before, l.after
  from public.audit_log l
  left join public.profiles p on p.id = l.actor_id
  where (p_actor  is null or l.actor_id = p_actor)
    and (p_entity is null or l.entity = p_entity)
    -- Inclusive at both ends, in Athens time: "from the 3rd to the 5th"
    -- includes everything that happened on the 5th.
    and (p_from   is null or (l.at at time zone 'Europe/Athens')::date >= p_from)
    and (p_to     is null or (l.at at time zone 'Europe/Athens')::date <= p_to)
  order by l.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

comment on function public.admin_audit_log(uuid, text, date, date, integer, integer) is
  'A9 · the audit log, filtered by actor, entity and Athens-time date. Joins the actor''s name and nothing else — never anything app.audit_redact() removed.';

-- The entity filter offers what the log actually contains rather than a
-- hard-coded list of table names that would drift from the trigger list in
-- 0010_guards.sql the first time a table gains or loses auditing.
create or replace function public.admin_audit_entities()
returns table (entity text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  return query
  select distinct l.entity from public.audit_log l order by 1;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_audit_log(uuid,text,date,date,integer,integer)',
    'public.admin_audit_entities()'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;
