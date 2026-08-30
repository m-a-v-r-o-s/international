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
