-- ═════════════════════════════════════════════════════════════════════════════
-- 0036 · Notifications, removed
--
-- Superseded: docs/01-DECISIONS.md §22. Push notifications — the admin's
-- incident inbox and a rep's morning/evening digest — are gone from every
-- layer: the service worker, the settings UI, the sender, the three Railway
-- cron services, and now this schema. Nothing that carried real business data
-- is touched — bookings, incidents and exceptions are exactly as they were.
-- What goes is the machinery that told a phone about them: subscriptions,
-- preferences, and the "already announced" stamps and queries built only to
-- feed that machinery.
--
-- rep_day_movements() is dropped along with the rest even though it reads
-- ordinary booking data, because every caller of it was the push sender
-- (src/lib/push/notify.ts, now deleted) — nothing else in the app ever called
-- it, and the booking rows it read remain queryable through every path that
-- already existed before push did.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── The sender's API ─────────────────────────────────────────────────────────
drop function public.pending_incident_notifications(integer);
drop function public.mark_incidents_notified(uuid[]);
drop function public.rep_day_movements(uuid, date);
drop function public.push_targets(text);
drop function public.drop_push_subscription(text);

-- ── Subscriptions ────────────────────────────────────────────────────────────
-- Drops the push_own policy and its grants along with the table.
drop table public.push_subscriptions;

-- ── Preferences and the "already told" stamp ────────────────────────────────
alter table public.profiles
  drop column notify_morning,
  drop column notify_evening,
  drop column notify_incidents;

alter table public.incidents drop column notified_at;

-- ── The guard, re-pasted without the clamp it existed to enforce ───────────
-- Same function as 20260903100000_rep_chooses_own_pin.sql, minus the
-- notify_morning/notify_evening block — those columns no longer exist to
-- clamp.
create or replace function app.profiles_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id         := old.id;
    new.created_at := old.created_at;

    -- Nobody sets a PIN through the table, including the rep it belongs to —
    -- the rep's own "change my PIN" goes through public.set_pin_hash() on the
    -- service role like every other write of this column, where auth.uid() is
    -- null and this steps aside. Nor may anyone clear the must-change flag
    -- without going through the same function: dismissing the prompt and
    -- actually replacing the PIN are one act, and this is what makes them one.
    if auth.uid() is not null then
      new.pin_hash        := old.pin_hash;
      new.pin_must_change := old.pin_must_change;
    end if;
  end if;

  return new;
end;
$$;

comment on function app.profiles_before_write() is
  'BEFORE UPDATE guard on profiles: restores id/created_at, lets only the server (auth.uid() null, via public.set_pin_hash()) write pin_hash and pin_must_change. Hiding a control in the UI is not access control (docs/03-SECURITY.md rule 5) — this is what actually enforces it.';
