-- ═════════════════════════════════════════════════════════════════════════════
-- 0020 · Retention · the licence-image purge (docs/01-DECISIONS.md §25)
--
-- "Licence images are auto-deleted after an admin-set window (default 24
-- months after the rental ends). The booking record, contract PDF and typed
-- licence number are retained. Every purge is logged."
--
-- THE PURGE DELETES REAL PERSONAL DATA AND CANNOT BE UNDONE, so the shape here
-- is defensive on purpose:
--
--   · THE PREDICATE IS POSITIVE, NEVER A NEGATION. Nothing is deleted because
--     the sweep failed to find a reason to keep it. An object is due only if a
--     booking row exists, its end_date is older than the window, and the
--     object sits under <booking>/licences/. An object whose booking has
--     vanished is an ORPHAN: it is counted and reported, never swept. A
--     negation over a join is the shape that deletes the world the day the
--     join breaks.
--   · THE FOLDER DECIDES, NOT THE FILENAME, and not booking_drivers'
--     front_image_path / back_image_path. That column is granted to
--     `authenticated` at table level, so a rep can clear their own driver's
--     pointer — which must not be a way to make a scanned licence outlive its
--     window. There is already a test saying so
--     (tests/db/storage-isolation.test.ts).
--   · A MALFORMED OBJECT NAME IS SKIPPED, NOT AN ERROR. The sweep reads paths
--     through app.object_booking_id() and app.object_file_kind(), the same two
--     helpers the bucket policies use, which return null instead of raising on
--     anything that is not <booking>/<kind>/<file>. A bare `::uuid` cast in
--     the join would raise 22P02 on one bad row and abandon the whole sweep.
--   · IT CANNOT REACH A CONTRACT OR A SIGNATURE. `= 'licences'` is the only
--     kind that satisfies it, which is the reason the kind folder exists
--     (supabase/migrations/20260830120000_storage.sql).
--
-- NOTHING HERE DELETES ANYTHING. These functions report; the deletion is done
-- by src/lib/retention/purge.ts through the Storage API. That is a correction
-- to the plan written down in docs/06-IMPLEMENTATION-NOTES.md, which had the
-- sweep as `delete from storage.objects ...`: on Supabase that removes the
-- METADATA ROW and leaves the object itself in the bucket's backing store. A
-- purge that leaves the file behind while recording that it deleted it is
-- worse than no purge at all, so the deletion goes through the API that owns
-- both halves, and this migration hands it the list.
-- ═════════════════════════════════════════════════════════════════════════════

-- The cut-off, read from the same settings row A10 writes, so the window shown
-- on screen and the window the sweep applies cannot disagree.
create or replace function app.licence_retention_cutoff()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select app.today() - make_interval(months =>
    (select s.licence_retention_months from public.app_settings s where s.id = 1))
$$;

comment on function app.licence_retention_cutoff() is
  'A rental that ended on or before this date has had its licence images long enough (docs/01-DECISIONS.md §25). Read from app_settings, never passed in.';

-- ── The list ────────────────────────────────────────────────────────────────
-- `end_date` is the date the rental was contracted to end. It is a `date` and
-- not an instant, it never moves backwards (IR110 refuses to shorten a rental
-- in progress), and an extension moves it forward — which correctly pushes the
-- purge later. returned_at is deliberately not used: an early return frees the
-- car but does not shorten the rental (§4).
create or replace function public.licence_images_due_for_purge(p_limit integer default 500)
returns table (object_name text, booking_id uuid, ended_on date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select o.name, b.id, b.end_date
  from storage.objects o
  join public.bookings b on b.id = app.object_booking_id(o.name)
  where o.bucket_id = 'booking-files'
    and app.object_file_kind(o.name) = 'licences'
    and b.end_date <= app.licence_retention_cutoff()
  order by b.end_date, o.name
  limit greatest(1, least(coalesce(p_limit, 500), 5000));
end;
$$;

comment on function public.licence_images_due_for_purge(integer) is
  'Licence images whose rental ended longer ago than the retention window. Reports only — src/lib/retention/purge.ts deletes them through the Storage API, because deleting the row here would leave the file in the bucket.';

-- ── Recording that it happened ──────────────────────────────────────────────
-- Called once per batch, after the Storage API has confirmed the deletes.
-- `images_purged_at` is the fact; the pointers are nulled because a pointer to
-- a file that no longer exists is a broken link on a screen, and the typed
-- licence number — which §25 says is RETAINED — is untouched.
create or replace function public.mark_licences_purged(p_booking_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  if p_booking_ids is null or array_length(p_booking_ids, 1) is null then
    return 0;
  end if;

  update public.booking_drivers d
     set images_purged_at  = now(),
         front_image_path  = null,
         back_image_path   = null
   where d.booking_id = any (p_booking_ids)
     and d.images_purged_at is null;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ── What A10 shows the boss ─────────────────────────────────────────────────
-- Admin-readable counts, so the retention screen can say what is about to
-- happen before anybody presses anything. `orphans` is the number of licence
-- objects whose booking row is gone: never swept, always reported, because the
-- honest thing to do with data the predicate cannot account for is to say so.
create or replace function public.admin_licence_retention_status()
returns table (
  retention_months smallint,
  cutoff date,
  due_count bigint,
  orphan_count bigint,
  oldest_due date,
  purged_drivers bigint,
  last_purge_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  return query
  select
    (select s.licence_retention_months from public.app_settings s where s.id = 1),
    app.licence_retention_cutoff(),
    (select count(*)
       from storage.objects o
       join public.bookings b on b.id = app.object_booking_id(o.name)
      where o.bucket_id = 'booking-files'
        and app.object_file_kind(o.name) = 'licences'
        and b.end_date <= app.licence_retention_cutoff()),
    (select count(*)
       from storage.objects o
      where o.bucket_id = 'booking-files'
        and app.object_file_kind(o.name) = 'licences'
        and not exists (select 1 from public.bookings b
                        where b.id = app.object_booking_id(o.name))),
    (select min(b.end_date)
       from storage.objects o
       join public.bookings b on b.id = app.object_booking_id(o.name)
      where o.bucket_id = 'booking-files'
        and app.object_file_kind(o.name) = 'licences'
        and b.end_date <= app.licence_retention_cutoff()),
    (select count(*) from public.booking_drivers d where d.images_purged_at is not null),
    (select max(e.at) from app.auth_events e where e.kind = 'licence_purge');
end;
$$;

-- The two service-role functions are the job's own API and no session may
-- reach them; the status function is A10's and asserts admin itself.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.licence_images_due_for_purge(integer)',
    'public.mark_licences_purged(uuid[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

revoke all on function public.admin_licence_retention_status() from public;
grant execute on function public.admin_licence_retention_status()
  to authenticated, service_role;
