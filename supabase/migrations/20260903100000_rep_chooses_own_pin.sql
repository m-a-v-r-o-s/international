-- ═════════════════════════════════════════════════════════════════════════════
-- 0034 · The rep chooses their own PIN, and a PIN the boss issued is temporary
--
-- This reverses the first half of 0027 (docs/01-DECISIONS.md §38 supersedes the
-- self-service half of §32). 0027 took rep-side PIN changes away at the owner's
-- ask; he has now asked for them back, with the prompt made unavoidable rather
-- than optional: a rep who signs in with a PIN the boss generated is asked to
-- replace it, and asked again on every sign-in until they do.
--
-- §32 wrote the cost of the old shape down in one sentence — "the boss knows the
-- initial PIN" — and answered it with "he is the owner anyway". That answer was
-- true about authority and beside the point about credentials: a PIN two people
-- know is not a credential that identifies one of them, and `bookings.created_by`
-- and every audit row underneath it are claims about WHICH person did something.
-- The generated PIN stays exactly what it was — a handover token, read off a
-- screen, good enough to get a rep in once. This makes it stop being anything
-- more than that.
--
-- WHAT ACTUALLY CHANGES DOWN HERE is smaller than the decision sounds, because
-- the shape 0027 built is the right shape and is kept:
--
--   · public.set_pin_hash() is still the ONLY writer of pin_hash, still SECURITY
--     DEFINER, still service_role only. A rep does not get a grant, a policy or
--     an RPC of their own — the Node action authenticates them, argon2-hashes
--     what they typed, and calls the same function the boss's re-issue calls.
--     Nothing new is reachable from a browser holding the anon key.
--   · app.profiles_before_write() still refuses a pin_hash write from any caller
--     with an auth.uid(), so the raw-PostgREST gap 0027 closed stays closed.
--
-- What is new is that the function now has to record WHICH KIND of PIN it just
-- stored, because that is the whole of the new behaviour.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── The flag ─────────────────────────────────────────────────────────────────
-- Deliberately not granted to `authenticated`, on select or update. Not because
-- it is a secret — the rep is about to be told in a heading — but because the
-- only writer that may set it is the same service-role function that writes the
-- hash it describes, and a column a rep can UPDATE is a prompt a rep can dismiss
-- with one PostgREST call. src/lib/auth/session.ts reads it through the service
-- role alongside pin_hash, in a query it was already making.
alter table public.profiles
  add column pin_must_change boolean not null default false;

comment on column public.profiles.pin_must_change is
  'True while pin_hash holds a PIN the BOSS generated (account creation or re-issue) rather than one the rep chose. Set by public.set_pin_hash() and by nothing else; the app refuses to show any screen but /change-pin while it is true.';

-- Every rep already in the table is holding a PIN the boss generated — that was
-- the only kind there was — so every one of them is asked to replace it at their
-- next sign-in. The pilot has not started (§32's October date), so this is a
-- handful of rows, and the alternative is a fleet of accounts permanently exempt
-- from the rule on the grounds that they predate it.
--
-- `role = 'rep'` and not merely `pin_hash is not null`: the boss has no PIN by
-- design (§21) and must never be sent to a screen that asks him to change one.
update public.profiles
   set pin_must_change = true
 where role = 'rep'
   and pin_hash is not null;

-- ── The guard ────────────────────────────────────────────────────────────────
-- Re-pasted whole rather than extended, the same way 0027 re-pasted it: it is
-- short, and a second trigger for one more assignment would scatter the answer
-- to "what may a rep write on their own row" across two files.
--
-- pin_must_change is restored from `old` under exactly the condition pin_hash is,
-- and for the same reason. There is no grant behind it today, so this is belt to
-- that braces — but the grant on pin_hash was not supposed to be reachable either
-- (0011 granted it, 0018 assumed the owner check covered it) and 0027 exists
-- because it was. A guard that names the column costs one line and does not
-- depend on a grant list staying the way it is.
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
  'BEFORE UPDATE guard on profiles: restores id/created_at, lets only the server (auth.uid() null, via public.set_pin_hash()) write pin_hash and pin_must_change, and clamps notify_morning/notify_evening to true for a rep row. Hiding a control in the UI is not access control (docs/03-SECURITY.md rule 5) — this is what actually enforces it.';

-- ── The writer ───────────────────────────────────────────────────────────────
-- Dropped and recreated rather than overloaded. `create or replace` cannot add a
-- parameter — it would leave the two-argument function standing beside the new
-- one, and "the only writer of that column" is a sentence this schema has now
-- said three times. There is exactly one writer, and it takes an answer to the
-- question that decides everything downstream.
--
-- p_boss_issued rather than a default, so no call site can decline to answer it.
-- There are four, and each one knows: createRepAccount() and reissueRepPin()
-- pass true (src/lib/users/accounts.ts), changePin() and the null-hash fallback
-- setPin() pass false. A default would have made "the boss issued this" the
-- thing that happens when nobody thought about it, which is the wrong way round
-- — the safe default is the value that ASKS again, and that is what an omitted
-- argument would have to mean; better that it cannot be omitted.
drop function public.set_pin_hash(uuid, text);

-- Argon2 hashing happens in the Node process, never in SQL. This only stores the
-- result, and only for the rep it belongs to.
create or replace function public.set_pin_hash(
  p_profile_id uuid, p_hash text, p_boss_issued boolean
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set pin_hash        = p_hash,
         pin_must_change = p_boss_issued
   where id = p_profile_id
$$;

comment on function public.set_pin_hash(uuid, text, boolean) is
  'Stores an argon2id PIN hash for one profile and records whether the boss generated it (true → the rep is asked to replace it at every sign-in until they do) or the rep chose it (false). The only writer of profiles.pin_hash and profiles.pin_must_change; service_role only.';

-- Mandatory for every function added to `public` (docs/01-DECISIONS.md §30):
-- Supabase's default privileges grant EXECUTE to `anon` and `authenticated`
-- explicitly, so revoking from `public` alone leaves both holding it and
-- tests/db/privileges.test.ts fails. The dropped signature took its own grants
-- with it, so this is the whole of the new one's.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.set_pin_hash(uuid,text,boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
