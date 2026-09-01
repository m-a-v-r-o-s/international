-- ═════════════════════════════════════════════════════════════════════════════
-- 0029 · A rep's PIN is their whole credential
--
-- The owner's decision (docs/01-DECISIONS.md §32): a rep never sees or types a
-- password. The boss creates the account, the screen shows a PIN once, and that
-- PIN is what the rep signs in with from then on — no password step and no
-- separate "now choose a PIN" step behind it.
--
-- Everything that enforces the PIN itself already exists and is unchanged:
-- argon2id hashing in the Node process (src/lib/auth/pin.ts), public.set_pin_hash()
-- as the only writer, and app.profiles_before_write() (0027) refusing a pin_hash
-- write from any caller that has an auth.uid(). What was missing is the read on
-- the OTHER side of the sign-in: at the moment a rep types their PIN there is no
-- session yet, so nothing about them is reachable through the anon key — not the
-- profile, not the role, and certainly not the hash to verify against.
--
-- public.credential_lookup_for_email() is that read, and it is the same shape and
-- the same posture as public.role_for_email() next to it in 0013: SECURITY
-- DEFINER over `auth.users` joined to `public.profiles`, service_role only, and
-- an answer the server keeps to itself. The login screen still says exactly one
-- thing for an unknown address, a deactivated one, the boss's, and a wrong PIN,
-- so this cannot become a way to test an email against the staff list.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Who is this address, and what would a PIN have to match? ─────────────────
-- Deliberately NOT filtered to active reps the way role_for_email() filters to
-- active accounts. The caller has to tell a rep from the boss and an active row
-- from a deactivated one — a deactivated rep gets 'inactive' on the OTP path
-- today and should not silently become 'wrong PIN' here — and a filter that
-- returned no row for either case would take that distinction away. The three
-- facts travel together because the alternative is three round trips through
-- the service role for one login attempt.
--
-- `pin_hash` leaves the database here, which is the one thing in this file worth
-- being uncomfortable about. It is an argon2id digest, never the PIN; it goes to
-- the Node process that is the only place argon2 runs at all (verification
-- cannot happen in SQL — pgcrypto has no argon2); and it is granted to
-- service_role alone, which is the same key that could already read the column
-- straight off public.profiles.
create or replace function public.credential_lookup_for_email(p_email text)
returns table (
  id       uuid,
  role     public.user_role,
  active   boolean,
  pin_hash text
)
language sql
security definer
set search_path = ''
as $$
  select p.id, p.role, p.active, p.pin_hash
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email))
$$;

comment on function public.credential_lookup_for_email(text) is
  'Server-only: resolves a sign-in address to the profile id, role, active flag and argon2 PIN hash, so a rep can be authenticated by PIN alone before any session exists. Never answers the browser — service_role only, and the login screen returns one identical failure for every reason it can fail.';

-- Mandatory for every function added to `public` (docs/01-DECISIONS.md §30):
-- Supabase's default privileges grant EXECUTE to `anon` and `authenticated`
-- explicitly, so revoking from `public` alone leaves both holding it and
-- tests/db/privileges.test.ts fails.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.credential_lookup_for_email(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
