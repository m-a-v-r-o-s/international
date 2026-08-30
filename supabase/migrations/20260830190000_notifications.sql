-- ═════════════════════════════════════════════════════════════════════════════
-- 0023 · Notifications (docs/01-DECISIONS.md §22)
--
-- "Admin: exceptions — damage flagged, car not returned, eligibility override.
--  Reps: morning summary of their pickups, evening reminder of returns due."
--
-- `push_subscriptions` has existed since Phase 1 with nothing reading it. Two
-- things were missing besides a sender:
--
-- 1. NOWHERE TO SAY NO. R8 lists notification preferences
--    (docs/04-SCREENS.md), and there was no column to hold one. Three
--    booleans on `profiles`, one per kind of message in §22, rather than a
--    jsonb blob — they are queried by the sender on every run, and a person
--    who has turned a kind off should be excluded by the query rather than
--    filtered out in TypeScript afterwards.
--
-- 2. NO WAY TO KNOW WHAT HAD ALREADY BEEN SENT. An exception is raised by the
--    return flow, by the pickup flow, and by public.admin_override_eligibility()
--    — three paths today and more later. Hooking a send onto each one means
--    the fourth path added in a year silently notifies nobody, so the sender
--    sweeps for exceptions it has not announced yet and stamps them.
--    `notified_at` is that stamp. It is set by the sender on the service role
--    and by nothing else: it is absent from every client grant, so a rep
--    cannot mark the boss's inbox as read.
--
-- WHAT A REP'S NOTIFICATION MAY CONTAIN is decided here as much as in the
-- sender. rep_day_movements() returns the rep's OWN movements as rows — times,
-- plates, names — and no count, no sum and no total. docs/01-DECISIONS.md §7
-- allows a rep exactly one aggregate, their own cash in hand, and Phase 3
-- already declined to put a count of today's pickups on R1 on the grounds that
-- a count of rentals starting today is a figure company revenue can be worked
-- back from. A push message saying "4 pickups today" would put back exactly
-- what that decision left out, so the summary lists the movements instead —
-- which is more useful at a hotel desk anyway.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Preferences ──────────────────────────────────────────────────────────
alter table public.profiles
  add column notify_morning    boolean not null default true,
  add column notify_evening    boolean not null default true,
  add column notify_exceptions boolean not null default true;

comment on column public.profiles.notify_morning is
  'Rep: the morning summary of their own pickups (docs/01-DECISIONS.md §22).';
comment on column public.profiles.notify_exceptions is
  'Admin: an exception was raised. Reps never receive these — an exception is the boss''s business (§14).';

grant select (notify_morning, notify_evening, notify_exceptions) on public.profiles to authenticated;
grant update (notify_morning, notify_evening, notify_exceptions) on public.profiles to authenticated;

-- ── 2. What has already been announced ──────────────────────────────────────
alter table public.exceptions add column notified_at timestamptz;

comment on column public.exceptions.notified_at is
  'When the boss was pushed this exception. Written by the notifier on the service role only — absent from every client grant, so nobody can clear the boss''s inbox.';

-- ── The sender's own API ────────────────────────────────────────────────────
-- Everything below runs as service_role, on the server's own behalf, the same
-- category as the rate limiter and the retention job.

-- Exceptions raised but not yet announced, with just enough to write a line of
-- text: the type, the booking reference and the plate. No charge, no
-- resolution, no customer.
create or replace function public.pending_exception_notifications(p_limit integer default 50)
returns table (
  id uuid,
  type public.exception_type,
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
  select e.id, e.type, e.raised_at, b.ref, c.plate
  from public.exceptions e
  join public.bookings b on b.id = e.booking_id
  join public.cars c on c.id = b.car_id
  where e.notified_at is null
  order by e.raised_at
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

create or replace function public.mark_exceptions_notified(p_ids uuid[])
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

  update public.exceptions e
     set notified_at = now()
   where e.id = any (p_ids) and e.notified_at is null;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

/*
 * One rep's own movements for one day — the same set §8 lets them see: a
 * rental they created, or one at a hotel they are stationed at or cover.
 *
 * Rows, never a count. See the header.
 */
create or replace function public.rep_day_movements(p_profile_id uuid, p_on date)
returns table (
  kind text,
  booking_id uuid,
  at timestamptz,
  plate text,
  guest text,
  room text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    case when b.start_date = p_on then 'pickup' else 'return' end,
    b.id,
    case when b.start_date = p_on then b.pickup_at else b.dropoff_at end,
    c.plate,
    trim(coalesce(b.cust_first, '') || ' ' || coalesce(b.cust_last, '')),
    b.room_number
  from public.bookings b
  join public.cars c on c.id = b.car_id
  where b.kind = 'rental'
    and b.status in ('booked', 'out')
    and (b.start_date = p_on or b.end_date = p_on)
    and (
      b.created_by = p_profile_id
      or b.hotel_id in (select hr.hotel_id from public.hotel_reps hr
                        where hr.profile_id = p_profile_id)
    )
  order by 1 desc, 3 nulls last, 4;
end;
$$;

-- Who to send to, and their devices. Inactive accounts are excluded here
-- rather than in the sender: a deactivated rep is not staff (0019), and a
-- notification is not an exception to that.
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
      when 'morning'    then p.role = 'rep'   and p.notify_morning
      when 'evening'    then p.role = 'rep'   and p.notify_evening
      when 'exceptions' then p.role = 'admin' and p.notify_exceptions
      else false
    end;
end;
$$;

-- A push endpoint that the browser vendor has retired (410 Gone) is dead
-- weight and a retry loop waiting to happen. The sender drops it.
create or replace function public.drop_push_subscription(p_endpoint text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  delete from public.push_subscriptions where endpoint = p_endpoint;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.pending_exception_notifications(integer)',
    'public.mark_exceptions_notified(uuid[])',
    'public.rep_day_movements(uuid,date)',
    'public.push_targets(text)',
    'public.drop_push_subscription(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
