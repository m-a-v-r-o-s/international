-- ═════════════════════════════════════════════════════════════════════════════
-- 0033 · A model's picture, and the two specs a guest asks about
--
-- Two changes, both driven by R2 becoming a visual list of MODELS rather than
-- a list of plates (docs/04-SCREENS.md).
--
-- 1. ENGINE SIZE AND POWER. `car_models` carried the specs a rep needs to
--    place a guest in the right car — seats, doors, gearbox, fuel — and none
--    of the two a guest asks unprompted at the desk: how big is the engine and
--    how strong is it. Both are nullable: an electric model has no cc at all,
--    and a model whose brochure figure nobody has looked up yet is a model
--    that should still be bookable.
--
-- 2. THE MODEL PHOTO. `car_models.photo_path` has existed since 0003 and has
--    never had a bucket to point at, so it was null on every row. R2's card is
--    built around that picture, and the admin's "Add car model" form now
--    requires one.
--
-- ── Why this bucket is PUBLIC, when booking-files is emphatically not ───────
-- The two buckets hold opposite kinds of thing and get opposite policies, and
-- the reasoning is worth writing down so neither drifts toward the other.
--
-- `booking-files` holds scanned driving licences of foreign tourists. Private,
-- signed URLs, short TTL, per-booking authorisation (0016).
--
-- `fleet-photos` holds a studio-ish photo of a Fiat Panda. It is the same
-- picture the company would put on a rate card or a shopfront window; it
-- names no person, belongs to no booking, and is shown to every rep on every
-- availability search. A private bucket would mean minting a signed URL per
-- model per page load — sixteen round trips to render one screen — to protect
-- a photograph of a car that is parked outside in public. So: public READ,
-- and writes locked to the admin by the policies below.
--
-- What "public" does NOT mean: it does not mean writable. Anonymous callers
-- get no insert, update or delete here, and neither do reps. Only a caller
-- app.is_admin() answers true for may put a file in this bucket at all, which
-- is the same rule that already gates public.car_models itself (0004). The
-- content whitelist is enforced twice over, as it is for booking-files: the
-- bucket's own allowed_mime_types below, and src/lib/storage/fleet-photos.ts
-- sniffing the leading bytes before the upload is attempted, because a
-- browser-supplied MIME type decides nothing (docs/03-SECURITY.md).
--
-- ── The path ────────────────────────────────────────────────────────────────
--
--     <model_id>/<random>.<ext>
--
-- Two segments, and the first is the model. The basename is random rather than
-- fixed because the bucket is public and therefore CDN-cached: a replaced
-- photo written to the same name would serve the old picture until the edge
-- expired it. A fresh name per upload means the new URL is new, and the
-- previous object is deleted by the action that replaced it.
-- This shape is fixed here and in src/lib/storage/fleet-photos.ts, and neither
-- may change without the other.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1 · Engine size and power ───────────────────────────────────────────────
-- smallint tops out at 32767, which is comfortably above any cc or bhp a rental
-- fleet will hold; the CHECKs keep a typo out rather than guarding the type.
alter table public.car_models
  add column engine_cc  smallint check (engine_cc between 50 and 9999),
  add column horsepower smallint check (horsepower between 1 and 2000);

comment on column public.car_models.engine_cc is
  'Engine displacement in cc. Null for electric models, and for any model whose figure has not been looked up.';
comment on column public.car_models.horsepower is
  'Metric horsepower (PS), as the brochure states it. Null when unknown.';

-- ── 2 · The bucket ──────────────────────────────────────────────────────────
-- 5 MB, half what booking-files allows: this is one photo chosen once by the
-- admin at a desk, not a licence shot by a rep on a phone in a hurry.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fleet-photos', 'fleet-photos', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── Reading the path ────────────────────────────────────────────────────────
-- Same contract as app.object_booking_id() in 0016: a malformed name is a null
-- and therefore a refusal, never an exception. A policy that raises turns a
-- guess into a 500 and tells the caller how far the guess got.
create or replace function app.object_model_id(p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_parts text[];
begin
  v_parts := storage.foldername(p_name);
  if array_length(v_parts, 1) is distinct from 1 then
    return null;
  end if;
  return v_parts[1]::uuid;
exception when others then
  return null;
end;
$$;

comment on function app.object_model_id(text) is
  'The car model a fleet-photos object belongs to, read from the first path segment. Null for any name that is not exactly <model_id>/<file>, which then fails every write policy below.';

grant execute on function app.object_model_id(text) to authenticated, service_role;

-- ── The policies ────────────────────────────────────────────────────────────
-- Read is open, which is what `public = true` already means at the CDN; the
-- policy exists so that reading through the authenticated API agrees with
-- reading through the public URL rather than being quietly stricter.
create policy fleet_photos_select on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'fleet-photos');

-- Write is the admin and nobody else. The object must also name a model that
-- actually exists — a file parked under a made-up uuid would be unreferenced
-- bytes no screen could ever show and no action could ever clean up.
create policy fleet_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fleet-photos'
    and app.is_admin()
    and exists (select 1 from public.car_models m where m.id = app.object_model_id(name))
  );

create policy fleet_photos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'fleet-photos' and app.is_admin())
  with check (
    bucket_id = 'fleet-photos'
    and app.is_admin()
    and exists (select 1 from public.car_models m where m.id = app.object_model_id(name))
  );

-- Deletable, unlike a signature or a contract: a model photo is a picture the
-- admin picked and may pick again, and the replace path deletes the object it
-- superseded so the bucket does not fill with orphans.
create policy fleet_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'fleet-photos' and app.is_admin());
