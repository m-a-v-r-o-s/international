-- ─────────────────────────────────────────────────────────────────────────────
-- 0007 · Audit, settings, push, rate limiting, security events
-- ─────────────────────────────────────────────────────────────────────────────

-- Permanent. Admin-readable, nobody-writable except the triggers.
-- Never contains licence numbers, tokens or secrets — see app.audit_redact().
create table public.audit_log (
  id            bigserial primary key,
  actor_id      uuid references public.profiles,
  entity        text not null,
  entity_id     uuid,
  action        text not null check (action in ('insert','update','delete')),
  before        jsonb,
  after         jsonb,
  at            timestamptz not null default now()
);

create index on public.audit_log (entity, entity_id, at desc);
create index on public.audit_log (actor_id, at desc);
create index on public.audit_log (at desc);

create table public.app_settings (
  id                       smallint primary key default 1 check (id = 1),
  licence_retention_months smallint not null default 24
                             check (licence_retention_months between 1 and 120),
  pickup_window            text not null default '08:30-11:30',
  dropoff_window           text not null default '18:00-21:00',
  -- legal name, ΑΦΜ, address, phone, insurer, contract T&Cs (el + en)
  company                  jsonb not null default '{}'::jsonb,
  updated_at               timestamptz not null default now()
);

insert into public.app_settings (id) values (1) on conflict do nothing;

create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles on delete cascade,
  endpoint      text not null unique,
  keys          jsonb not null,
  created_at    timestamptz not null default now()
);

create index on public.push_subscriptions (profile_id);

-- ── Rate limiting ───────────────────────────────────────────────────────────
-- Postgres-backed rather than in-memory: Railway can run more than one instance
-- and an in-memory counter would then be a suggestion, not a limit.
create table app.rate_limits (
  bucket        text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (bucket, window_start)
);

create index on app.rate_limits (window_start);

-- Returns true when the call is allowed, false when the bucket is exhausted.
create or replace function app.rate_limit_hit(
  p_bucket text,
  p_limit integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_hits integer;
begin
  if p_limit <= 0 then
    return false;
  end if;

  -- Fixed window, floored to the window size. Coarse, cheap, and good enough
  -- to stop credential stuffing and runaway OCR spend.
  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / extract(epoch from p_window))
    * extract(epoch from p_window));

  insert into app.rate_limits (bucket, window_start, hits)
  values (left(p_bucket, 200), v_window_start, 1)
  on conflict (bucket, window_start)
    do update set hits = app.rate_limits.hits + 1
  returning hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

-- Housekeeping for the retention/cron job.
create or replace function app.rate_limit_sweep(p_older_than interval default interval '1 day')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted integer;
begin
  delete from app.rate_limits where window_start < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ── Security events ─────────────────────────────────────────────────────────
-- Failed logins, PIN failures, device rebinds, signed-URL issuance for licence
-- images, retention purges. Never a token, never a licence number, never a
-- request body. Written only through app.log_security_event(), which is itself
-- rate limited so a hostile loop cannot flood storage.
create table app.auth_events (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  kind          text not null,
  profile_id    uuid references public.profiles on delete set null,
  email_hash    text,          -- sha256, so a log leak is not an address list
  ip_hash       text,
  detail        jsonb not null default '{}'::jsonb
);

create index on app.auth_events (at desc);
create index on app.auth_events (kind, at desc);
create index on app.auth_events (profile_id, at desc);

create or replace function app.log_security_event(
  p_kind text,
  p_profile_id uuid default null,
  p_email_hash text default null,
  p_ip_hash text default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Cap the write rate per kind+subject so a loop cannot blow out storage.
  if not app.rate_limit_hit(
       'seclog:' || p_kind || ':' || coalesce(p_profile_id::text, p_ip_hash, 'anon'),
       120, interval '1 minute') then
    return;
  end if;

  insert into app.auth_events (kind, profile_id, email_hash, ip_hash, detail)
  values (left(p_kind, 60), p_profile_id, p_email_hash, p_ip_hash,
          coalesce(p_detail, '{}'::jsonb));
end;
$$;
