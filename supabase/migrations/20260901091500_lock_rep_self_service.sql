-- ═════════════════════════════════════════════════════════════════════════════
-- 0027 · A rep no longer issues their own PIN changes or opts out of notifications
--
-- Two things the boss asked to take back from reps:
--
-- 1. PIN CHANGES. public.set_pin_hash() and the setPin() action already refuse
--    to run a second time (src/app/unlock/actions.ts), so the app-layer path is
--    closed. But `grant update (…, pin_hash) on public.profiles to authenticated`
--    (0011) plus app.profiles_before_write() only blocking a NON-OWNER caller
--    (0018 §4) meant a rep could still overwrite their OWN pin_hash with a raw
--    PostgREST call, bypassing the Next.js action entirely. Only the server,
--    through public.set_pin_hash() (auth.uid() is null there), may write it now.
--
-- 2. NOTIFICATION OPT-OUT. notify_morning and notify_evening are a rep's two
--    kinds (0021) and are meant to always be on, not a preference — the
--    settings screen no longer offers them a way to turn either off, and
--    saveNotificationPreferences() (settings/actions.ts) now refuses to write
--    either column for a rep. Same gap as the PIN: the update grant on those
--    columns is still there for `authenticated`, so a raw PostgREST call could
--    still flip one off. The trigger clamps both back to true for a rep row on
--    every write, the same way it already restores pin_hash.
--
-- app.profiles_before_write() is short enough to re-paste whole rather than add
-- a second trigger (contrast 0026, where bookings_guard's 200 lines earned a
-- backstop trigger instead).
-- ═════════════════════════════════════════════════════════════════════════════

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

    -- Nobody sets a PIN, including the rep it belongs to. auth.uid() is null
    -- when the server acts on its own behalf through public.set_pin_hash(),
    -- which is the only writer left standing after setPin()'s first-use guard.
    if auth.uid() is not null then
      new.pin_hash := old.pin_hash;
    end if;

    -- A rep's notification kinds are always on. There is no writer, server or
    -- direct, that should ever turn either off for a 'rep' row.
    if old.role = 'rep' then
      new.notify_morning := true;
      new.notify_evening := true;
    end if;
  end if;

  return new;
end;
$$;

comment on function app.profiles_before_write() is
  'BEFORE UPDATE guard on profiles: restores id/created_at, lets only the server (auth.uid() null, via public.set_pin_hash()) write pin_hash, and clamps notify_morning/notify_evening to true for a rep row. Hiding a control in the UI is not access control (docs/03-SECURITY.md rule 5) — this is what actually enforces it.';
