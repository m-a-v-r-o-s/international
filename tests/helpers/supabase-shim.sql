-- ─────────────────────────────────────────────────────────────────────────────
-- The parts of a Supabase database that our migrations assume already exist.
--
-- On Supabase these are created by the platform. Here they are recreated as
-- faithfully as the tests need, so the migrations under supabase/migrations run
-- unmodified against a real Postgres and the RLS policies are exercised through
-- the same `authenticated` role and the same auth.uid() that PostgREST uses.
-- ─────────────────────────────────────────────────────────────────────────────

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant anon, authenticated, service_role to current_user;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  encrypted_password  text,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Supabase's own definitions, verbatim in behaviour: the claims arrive as a GUC
-- set by PostgREST for the life of the request.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

grant execute on function auth.uid(), auth.role(), auth.email()
  to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- storage
--
-- Added in Phase 4 so the bucket policies in
-- supabase/migrations/20260830120000_storage.sql run under the SAME harness as
-- every other policy in this repo, rather than being shipped untested. The
-- alternative was a hand-check against a real Supabase project, which nothing
-- in CI could repeat.
--
-- Only what the policies actually touch is recreated: the two tables, the
-- column shape our migration writes and reads, and storage.foldername(), whose
-- exact behaviour (every segment BUT the last) the whole path convention rests
-- on. The storage API itself is not simulated — what is under test here is the
-- authorisation decision Postgres makes when the API asks it, which is the
-- decision behind both an upload and a signed URL.
-- ─────────────────────────────────────────────────────────────────────────────
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id                  text primary key,
  name                text not null unique,
  owner               uuid,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  public              boolean default false,
  avif_autodetection  boolean default false,
  file_size_limit     bigint,
  allowed_mime_types  text[]
);

create table storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets (id),
  name             text,
  owner            uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata         jsonb,
  version          text,
  path_tokens      text[] generated always as (string_to_array(name, '/')) stored,
  unique (bucket_id, name)
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

-- Supabase's own definition: everything before the final '/'. So for
-- `<booking>/<kind>/<file>` this is exactly ['<booking>', '<kind>'].
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end;
$$;

create or replace function storage.filename(name text)
returns text
language plpgsql
as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end;
$$;

grant execute on function storage.foldername(text), storage.filename(text)
  to anon, authenticated, service_role;

grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects
  to anon, authenticated, service_role;
