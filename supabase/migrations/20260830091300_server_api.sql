-- ═════════════════════════════════════════════════════════════════════════════
-- 0013 · The server's own API surface
--
-- PostgREST only exposes `public`, and these are things the Next.js server does
-- on its own behalf — never the browser. Each one is granted to `service_role`
-- alone, so a rep's session cannot reach them even with the anon key and a
-- hand-written request.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.rate_limit_hit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select app.rate_limit_hit(p_bucket, p_limit, make_interval(secs => p_window_seconds))
$$;

create or replace function public.log_security_event(
  p_kind text,
  p_profile_id uuid default null,
  p_email_hash text default null,
  p_ip_hash text default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  select app.log_security_event(p_kind, p_profile_id, p_email_hash, p_ip_hash, p_detail)
$$;

-- ── One device per rep (docs/01-DECISIONS.md §1) ────────────────────────────
-- Binding a rep to a new device replaces the old binding. The next request from
-- the old device fails public.rep_device_matches() and is signed out at the app
-- boundary.
create or replace function public.bind_rep_device(
  p_profile_id uuid,
  p_device_id text,
  p_user_agent text default null
)
returns boolean          -- true when this replaced a different device
language plpgsql
security definer
set search_path = ''
as $$
declare v_previous text;
begin
  select d.device_id into v_previous
  from public.rep_devices d where d.profile_id = p_profile_id;

  insert into public.rep_devices (profile_id, device_id, user_agent)
  values (p_profile_id, p_device_id, left(coalesce(p_user_agent, ''), 400))
  on conflict (profile_id) do update
    set device_id    = excluded.device_id,
        user_agent   = excluded.user_agent,
        bound_at     = now(),
        last_seen_at = now();

  return v_previous is not null and v_previous is distinct from p_device_id;
end;
$$;

create or replace function public.rep_device_matches(p_profile_id uuid, p_device_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_ok boolean;
begin
  select d.device_id = p_device_id into v_ok
  from public.rep_devices d where d.profile_id = p_profile_id;

  if v_ok is true then
    update public.rep_devices set last_seen_at = now() where profile_id = p_profile_id;
  end if;

  -- No binding yet is not a mismatch: the first sign-in on a device creates it.
  return coalesce(v_ok, true);
end;
$$;

-- Argon2 hashing happens in the Node process, never in SQL. This only stores
-- the result, and only for the rep it belongs to.
create or replace function public.set_pin_hash(p_profile_id uuid, p_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set pin_hash = p_hash where id = p_profile_id
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.rate_limit_hit(text,integer,integer)',
    'public.log_security_event(text,uuid,text,text,jsonb)',
    'public.bind_rep_device(uuid,text,text)',
    'public.rep_device_matches(uuid,text)',
    'public.set_pin_hash(uuid,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
