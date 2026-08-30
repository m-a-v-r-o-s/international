-- ═════════════════════════════════════════════════════════════════════════════
-- 0016 · The private bucket, and who may reach into it
--
-- Four kinds of file belong to a booking and none of them may ever have a
-- public URL: the licence photos (booking_drivers.front_image_path /
-- back_image_path), the photo on a damage mark (damage_marks.photo_path), the
-- guest's signature and the signed agreement (contracts.signature_path /
-- pdf_path). They hold scanned driving licences of foreign tourists — special-
-- category-adjacent personal data under GDPR, and a breach here is a
-- reportable incident (docs/03-SECURITY.md).
--
-- So: ONE private bucket, and the same authorisation rule the rest of the app
-- runs on. `app.can_read_booking()` already answers "may this caller see this
-- booking" for the bookings table, its drivers, its handovers and its damage
-- marks. The object policies below ask it the same question, so a file cannot
-- be reachable by anyone who could not already read the row that points at it.
-- There is no second rule to drift out of step with the first.
--
-- The path IS the authorisation key, which is why its shape is fixed here and
-- in src/lib/storage/paths.ts and nowhere else:
--
--     <booking_id>/<kind>/<filename>
--     kind ∈ (licences | damage | signature | contract)
--
-- storage.foldername() returns every segment but the last, so segment 1 is the
-- booking and segment 2 is the kind. Two consequences that are the point of
-- the layout:
--
--   · RETENTION. Licence images are auto-deleted after an admin-set window
--     (docs/01-DECISIONS.md §25, default 24 months after the rental ends)
--     while the contract PDF and the signature are retained. Because every
--     licence image sits under `<booking>/licences/` and nothing else does,
--     the Phase 5 purge job can enumerate exactly what it must delete from the
--     bucket alone, and `booking_drivers.images_purged_at` records that it
--     did. No other file kind can be caught by that sweep by accident.
--   · IMMUTABILITY. A signed agreement is evidence. `contracts` is granted
--     SELECT and INSERT to `authenticated` and nothing else, and the object
--     policies match: a rep may replace or delete a licence or damage photo
--     (a re-take, a mis-tap) but may not touch a signature or a contract PDF
--     once it exists. Only the service role — the retention job, run by the
--     server on its own behalf — bypasses this.
--
-- NOTE ON SUPABASE: `storage.objects` and `storage.buckets` are created by the
-- platform, not by us, which is why this migration only inserts a bucket row
-- and adds policies. Creating a policy on storage.objects from a migration is
-- the documented Supabase path (the migration runs as `postgres`, which holds
-- the rights on the storage schema). The test harness recreates both tables and
-- storage.foldername() in tests/helpers/supabase-shim.sql so these policies run
-- under the same real Postgres as every other policy in this repo.
-- ═════════════════════════════════════════════════════════════════════════════

-- 10 MB. A phone camera JPEG is 2–5 MB; a contract PDF with two licence images
-- and the diagram is well under one. Enforced by the storage API itself, on top
-- of the sniffing the upload path does before it ever gets here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'booking-files', 'booking-files', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── Reading the path ────────────────────────────────────────────────────────
-- A malformed object name must be a refusal, not an error: an exception raised
-- inside a policy would surface as a 500 and, worse, would tell the caller that
-- their guess got as far as the cast. Both helpers return null instead, and a
-- null booking id fails app.can_read_booking() like any other unreadable one.
create or replace function app.object_booking_id(p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_parts text[];
begin
  v_parts := storage.foldername(p_name);
  if array_length(v_parts, 1) is distinct from 2 then
    return null;
  end if;
  return v_parts[1]::uuid;
exception when others then
  return null;
end;
$$;

create or replace function app.object_file_kind(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_parts text[];
begin
  v_parts := storage.foldername(p_name);
  if array_length(v_parts, 1) is distinct from 2 then
    return null;
  end if;
  return v_parts[2];
exception when others then
  return null;
end;
$$;

comment on function app.object_booking_id(text) is
  'The booking a booking-files object belongs to, read from the first path segment. Null for any name that is not exactly <booking_id>/<kind>/<file>, which then fails every policy below.';

grant execute on function app.object_booking_id(text) to authenticated, service_role;
grant execute on function app.object_file_kind(text) to authenticated, service_role;

-- ── The policies ────────────────────────────────────────────────────────────
-- Read: exactly the bookings this caller can already read. This is also what
-- gates a signed URL — the storage API evaluates the SELECT policy before it
-- will mint one — so a rep asking for a URL to another booking's licence image
-- is refused by Postgres, not by the route handler that also checks.
create policy booking_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'booking-files'
    and app.can_read_booking(app.object_booking_id(name))
  );

create policy booking_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'booking-files'
    and app.object_file_kind(name) in ('licences', 'damage', 'signature', 'contract')
    and app.can_read_booking(app.object_booking_id(name))
  );

-- Replaceable and deletable: the two kinds a rep legitimately re-takes.
-- `signature` and `contract` are absent from both, so a signed agreement
-- cannot be overwritten or removed by anyone holding a session — including the
-- admin, whose route to correcting one is a new contract row (contracts.version).
create policy booking_files_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'booking-files'
    and app.object_file_kind(name) in ('licences', 'damage')
    and app.can_read_booking(app.object_booking_id(name))
  )
  with check (
    bucket_id = 'booking-files'
    and app.object_file_kind(name) in ('licences', 'damage')
    and app.can_read_booking(app.object_booking_id(name))
  );

create policy booking_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'booking-files'
    and app.object_file_kind(name) in ('licences', 'damage')
    and app.can_read_booking(app.object_booking_id(name))
  );
