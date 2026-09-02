-- ═════════════════════════════════════════════════════════════════════════════
-- 0030 · Exceptions become incidents
--
-- §14 gave the boss one queue for "anything non-standard", typed into six
-- kinds. Four of those six were not earning the queue:
--
--   · `late_return` and `no_show` were DEAD. Nothing in the codebase ever
--     inserted either one — they existed as enum values and a filter option and
--     nothing else. A late return is simply a rental that has not been returned
--     yet, which the booking's own status already says.
--   · `fuel_short` is ARITHMETIC. The owner's rule (2 Sep 2026) is €10 for every
--     missing eighth of a tank, so a queue item asking the boss to look at two
--     gauge readings and type in the product of them is a manual step over a
--     formula. It is now computed here, at the moment of return, and no longer
--     involves anybody.
--   · `eligibility_override` was the boss LOGGING HIS OWN ACTION BACK TO
--     HIMSELF. A rep has never been able to rent to a driver who fails a check
--     — the block is app.assert_drivers_eligible() on the booked → out
--     transition, and the only door around it, admin_override_eligibility(),
--     asserts admin itself. The override is already stamped on the booking
--     (eligibility_override_by/at) and in the audit log, so the queue item was
--     a third copy that also pushed the boss a notification about something he
--     had just done. The override stays; the queue item goes.
--
-- What is left is the one case that genuinely needs a person to look: damage,
-- and whatever else a rep finds that no rule anticipated. That case was the
-- worst served of the six, because it was raised AUTOMATICALLY from taps on the
-- return diagram — a poor way to say "the wing mirror is cracked, here is a
-- photo of it".
--
-- So the typed queue becomes ONE free-form record: a rep picks the contract,
-- writes plain text, attaches photos, and sends it to the boss, who reads it,
-- decides an amount and closes it. No type, no taxonomy, no dropdown to pick
-- the wrong option from. The boss's half of the deal is unchanged — the rep
-- still never prices it, argues it, or collects it (§14's real point).
--
-- The rename is not cosmetic: `exceptions` also had to be told apart from
-- "exception bookings" (0028), an unrelated queue for bookings awaiting the
-- boss's approval, which keeps its name and is untouched here.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. The table ────────────────────────────────────────────────────────────
-- Renamed in place rather than recreated, so rows, the audit trail's history
-- and every foreign key survive. Indexes, constraints and policies do not
-- follow a table rename on their own, so each is renamed too — a policy named
-- `exceptions_select` on a table called `incidents` is exactly the kind of
-- half-done rename someone reads later as a leftover from something else.
alter table public.exceptions rename to incidents;
alter table public.incidents  rename column detail to note;

alter table public.incidents rename constraint exceptions_pkey              to incidents_pkey;
alter table public.incidents rename constraint exceptions_booking_id_fkey   to incidents_booking_id_fkey;
alter table public.incidents rename constraint exceptions_raised_by_fkey    to incidents_raised_by_fkey;
alter table public.incidents rename constraint exceptions_resolved_by_fkey  to incidents_resolved_by_fkey;
alter table public.incidents rename constraint exceptions_detail_len        to incidents_note_len;
alter table public.incidents rename constraint exceptions_charge_check      to incidents_charge_check;

alter index public.exceptions_booking_id_idx  rename to incidents_booking_id_idx;
alter index public.exceptions_resolved_at_idx rename to incidents_resolved_at_idx;

alter policy exceptions_select on public.incidents rename to incidents_select;
alter policy exceptions_insert on public.incidents rename to incidents_insert;

alter trigger audit_exceptions on public.incidents rename to audit_incidents;

-- The taxonomy itself. Dropping the column drops its column grants with it.
-- The enum type outlives the column by a few sections: two functions still
-- name it in their return signature, and it cannot go until they have been
-- dropped — see the end of section 5.
alter table public.incidents drop column type;

comment on table public.incidents is
  'One thing a rep found and sent to the boss: plain text, photos, or both. Free-form on purpose — the typed queue this replaced spent four of its six types on things that were either dead, arithmetic, or the boss talking to himself (0030).';
comment on column public.incidents.note is
  'The rep''s own words. Never parsed, never matched against — read by a person.';
comment on column public.incidents.charge is
  'Set by the admin only, through public.admin_resolve_incident(). Not granted to authenticated.';
comment on column public.incidents.notified_at is
  'When the boss was pushed this incident. Written by the notifier on the service role only — absent from every client grant, so nobody can clear the boss''s inbox.';

-- Re-stated rather than left implicit. `note` inherited `detail`'s grants
-- through the rename and `type` took its own with it when it was dropped, so
-- these two lines are already true — but the next person to read this file
-- should not have to work that out to know what a rep may see and write.
grant select (id, booking_id, note, raised_by, raised_at, resolved_at)
  on public.incidents to authenticated;
grant insert (booking_id, note, raised_by) on public.incidents to authenticated;

-- ── 2. Photos ───────────────────────────────────────────────────────────────
-- A row per photo rather than a text[] on the incident: appending one during
-- composition is then a plain insert with no read-modify-write race between
-- two uploads finishing at once, and pulling a mis-taken one back is a plain
-- delete. `path` points into the same private bucket as everything else and is
-- never a URL — see section 3.
create table public.incident_photos (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents on delete cascade,
  path        text not null,
  added_by    uuid references public.profiles,
  added_at    timestamptz not null default now(),
  constraint incident_photos_path_len check (char_length(path) between 1 and 400)
);

create index on public.incident_photos (incident_id);

alter table public.incident_photos enable row level security;

grant select (id, incident_id, path, added_by, added_at) on public.incident_photos to authenticated;
grant insert (incident_id, path, added_by) on public.incident_photos to authenticated;
grant delete on public.incident_photos to authenticated;

-- Readable by exactly whoever can read the booking the incident hangs off —
-- app.can_read_booking() answering the same question it answers for the
-- incident itself, so a photo can never be reachable by someone who could not
-- already read the row that points at it.
create policy incident_photos_select on public.incident_photos
  for select to authenticated
  using (exists (select 1 from public.incidents i
                 where i.id = incident_photos.incident_id
                   and app.can_read_booking(i.booking_id)));

-- Evidence may only be added to an OPEN item. Once the boss has closed one,
-- bolting another photo onto it would change what he decided against.
create policy incident_photos_insert on public.incident_photos
  for insert to authenticated
  with check (exists (select 1 from public.incidents i
                      where i.id = incident_photos.incident_id
                        and i.resolved_at is null
                        and app.can_read_booking(i.booking_id)));

-- A mis-tap is the rep's own to withdraw, and only until the boss has ruled.
create policy incident_photos_delete on public.incident_photos
  for delete to authenticated
  using (added_by = auth.uid()
         and exists (select 1 from public.incidents i
                     where i.id = incident_photos.incident_id
                       and i.resolved_at is null
                       and app.can_read_booking(i.booking_id)));

create trigger audit_incident_photos after insert or update or delete on public.incident_photos
  for each row execute function app.audit();

-- ── 3. A fourth kind of file ────────────────────────────────────────────────
-- `<booking_id>/incidents/<file>`. The path is the authorisation key exactly as
-- it is for the other three (0016), so nothing about how a file is reached
-- changes — the kind list is simply longer. Mirrored in
-- src/lib/storage/paths.ts, which is the other half of this rule.
--
-- Insert and delete, but NOT update: every incident photo lands on a fresh
-- random basename, so there is no such thing as re-taking one in place. A rep
-- who took the wrong photo deletes it and adds another, which leaves the
-- deletion in the audit log rather than silently swapping the evidence under a
-- path the boss may already have looked at.
drop policy booking_files_insert on storage.objects;
create policy booking_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'booking-files'
    and app.object_file_kind(name) in ('licences', 'damage', 'signature', 'contract', 'incidents')
    and app.can_read_booking(app.object_booking_id(name))
  );

drop policy booking_files_delete on storage.objects;
create policy booking_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'booking-files'
    and app.object_file_kind(name) in ('licences', 'damage', 'incidents')
    and app.can_read_booking(app.object_booking_id(name))
  );

-- ── 4. The boss's two functions ─────────────────────────────────────────────
-- Renamed, and `type` drops out of both. The photos are NOT returned here:
-- `charge` and `resolution` need a SECURITY DEFINER route because they are
-- granted to nobody, but incident_photos is granted and policied like any
-- other table, so the boss's screen reads it directly.
drop function public.admin_resolve_exception(uuid, integer, text);

create function public.admin_resolve_incident(
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

  update public.incidents
     set charge      = p_charge,
         resolution  = nullif(left(coalesce(p_resolution, ''), 2000), ''),
         resolved_by = auth.uid(),
         resolved_at = now()
   where id = p_id;

  if not found then
    raise exception using errcode = 'IR112', message = 'incident not found';
  end if;
end;
$$;

revoke all on function public.admin_resolve_incident(uuid, integer, text) from public;
grant execute on function public.admin_resolve_incident(uuid, integer, text) to authenticated, service_role;

drop function public.admin_exception_detail(uuid);

create function public.admin_incident_detail(p_id uuid)
returns table (id uuid, booking_id uuid, note text,
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
  select i.id, i.booking_id, i.note, i.raised_by, i.raised_at,
         i.resolved_by, i.resolved_at, i.charge, i.resolution
  from public.incidents i
  where i.id = p_id;
end;
$$;

revoke all on function public.admin_incident_detail(uuid) from public;
grant execute on function public.admin_incident_detail(uuid) to authenticated, service_role;

-- ── 5. The notifier ─────────────────────────────────────────────────────────
-- Same sweep-and-stamp design (0023) — an incident is announced once, by a job
-- that looks for what it has not announced yet, rather than by a send hung off
-- each place one can be raised. The line of text loses the type and gains the
-- opening of the rep's note, which is the only thing there is to say now.
drop function public.pending_exception_notifications(integer);

create function public.pending_incident_notifications(p_limit integer default 50)
returns table (
  id uuid,
  note text,
  raised_at timestamptz,
  booking_ref text,
  plate text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select i.id, i.note, i.raised_at, b.ref, c.plate
  from public.incidents i
  join public.bookings b on b.id = i.booking_id
  join public.cars c on c.id = b.car_id
  where i.notified_at is null
  order by i.raised_at
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

drop function public.mark_exceptions_notified(uuid[]);

create function public.mark_incidents_notified(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  update public.incidents i
     set notified_at = now()
   where i.id = any (p_ids) and i.notified_at is null;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.pending_incident_notifications(integer)',
    'public.mark_incidents_notified(uuid[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

-- Nothing names the old taxonomy any more: the column went in section 1, and
-- the last two signatures carrying it were just replaced.
drop type public.exception_type;

-- The preference that decides who gets them.
alter table public.profiles rename column notify_exceptions to notify_incidents;

comment on column public.profiles.notify_incidents is
  'Admin: a rep sent in an incident. Reps never receive these — an incident is the boss''s business (§14).';

create or replace function public.push_targets(p_kind text)
returns table (
  profile_id uuid,
  lang text,
  endpoint text,
  keys jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select p.id, p.lang, s.endpoint, s.keys
  from public.profiles p
  join public.push_subscriptions s on s.profile_id = p.id
  where p.active
    and case p_kind
      when 'morning'   then p.role = 'rep'   and p.notify_morning
      when 'evening'   then p.role = 'rep'   and p.notify_evening
      when 'incidents' then p.role = 'admin' and p.notify_incidents
      else false
    end;
end;
$$;

-- ── 6. The override stops queueing itself ───────────────────────────────────
-- Unchanged in every other respect: still admin-only, still stamped on the
-- booking, still in the audit log. It simply no longer raises an item asking
-- the boss to look at what the boss just did.
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
end;
$$;

-- ── 7. Fuel is arithmetic ───────────────────────────────────────────────────
-- €10 for every eighth of a tank the car comes back short, settled at the
-- moment of return and involving nobody.
--
-- It lands on its OWN column, deliberately not added into `total`. `total` is
-- the figure on the agreement the guest signed, reproduced in the contract PDF;
-- quietly growing it afterwards would make the record disagree with the paper.
-- What the guest owes is the two figures side by side.
alter table public.app_settings
  add column fuel_charge_per_eighth integer not null default 10
    check (fuel_charge_per_eighth between 0 and 1000);

comment on column public.app_settings.fuel_charge_per_eighth is
  'Euros charged per missing eighth of a tank at return (docs/01-DECISIONS.md §14). A setting rather than a constant because it is a commercial rate, not a rule.';

alter table public.bookings
  add column fuel_charge integer check (fuel_charge is null or fuel_charge >= 0);

comment on column public.bookings.fuel_charge is
  'Computed by app.bookings_fuel_charge() on the → returned transition and by nothing else. Null means no shortfall (or no reading), which is not the same as a charge of zero.';

-- Selectable — the rep at the desk is the one who has to tell the guest — but
-- in no insert or update grant: it is derived, like `total` and `days`.
grant select (fuel_charge) on public.bookings to authenticated;

create or replace function app.bookings_fuel_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out  smallint;
  v_back smallint;
  v_rate integer;
begin
  if tg_op = 'INSERT' then
    new.fuel_charge := null;
    return new;
  end if;

  -- Authoritative in both directions: on any write that is not the return
  -- transition the stored value stands, whatever the statement carried. The
  -- column is in no client grant either, so this is the second lock, not the
  -- first.
  if new.kind <> 'rental' or new.status <> 'returned' or old.status = 'returned' then
    new.fuel_charge := old.fuel_charge;
    return new;
  end if;

  select h.fuel_eighths into v_out
  from public.handovers h
  where h.booking_id = new.id and h.kind = 'pickup';

  select h.fuel_eighths into v_back
  from public.handovers h
  where h.booking_id = new.id and h.kind = 'return';

  -- A missing reading is not a shortfall, and neither is a car brought back
  -- fuller than it left.
  if v_out is null or v_back is null or v_back >= v_out then
    new.fuel_charge := null;
    return new;
  end if;

  select s.fuel_charge_per_eighth into v_rate
  from public.app_settings s where s.id = 1;

  new.fuel_charge := (v_out - v_back) * coalesce(v_rate, 10);
  return new;
end;
$$;

-- 0026 revoked execute on everything in `app` that existed at the time; a
-- function created after it has to say so itself, the same as
-- app.bookings_enforce_pickup_window() (0027). A trigger function runs as the
-- table owner and needs no grant to anybody.
revoke all on function app.bookings_fuel_charge() from public;

-- Sorts before `bookings_guard`, so it runs first; it does not matter that it
-- does, because it reads the transition rather than contributing to it, and
-- the guard neither reads nor writes `fuel_charge`.
create trigger bookings_fuel_charge
  before insert or update on public.bookings
  for each row execute function app.bookings_fuel_charge();
