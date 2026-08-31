-- ═════════════════════════════════════════════════════════════════════════════
-- 0025 · admin_list_users() could not run on a real project
--
-- GAP FOUND ON THE FIRST REAL SUPABASE PROJECT, and it stopped A8 dead:
--
--     select * from public.admin_list_users();
--     ERROR:  42804: structure of query does not match function result type
--
-- `auth.users.email` is `character varying(255)` on Supabase.
-- tests/helpers/supabase-shim.sql declared it `text`, and
-- 20260830140000_users_and_hotels.sql declares `email text` in its
-- RETURNS TABLE and hands back `u.email` unchanged. plpgsql's RETURN QUERY
-- checks the row type EXACTLY — varchar(255) is not text — so the function
-- raised on every call against a real database and returned rows against the
-- harness. tests/db/admin-users.test.ts has asserted the emails it returns
-- since Phase 5 and passed the whole time.
--
-- This is the second finding of the same shape as
-- 20260830200000_privileges.sql: not a mistake in the SQL, but a place where
-- the shim was a more forgiving Postgres than the platform. Both are fixed in
-- the shim as well as here, so the harness cannot keep giving the answer the
-- platform will not.
--
-- WHAT IT COST, stated plainly, because it is worse than one broken screen:
-- A8 is the only way the boss creates a rep, and `email` is the column the
-- whole screen exists to show him — the address he hands over. Nothing else
-- reads it: `profiles` has no email column and no client role can select from
-- `auth.users`. So the pilot's first act, creating the two reps the October
-- build is for, would have failed at the first page load, in October, in
-- front of the client.
--
-- THE FIX IS A CAST AND NOTHING ELSE. The function body, its assertion, its
-- ordering and its grants are reproduced verbatim from 0018; `u.email::text`
-- is the only change. It is written as a cast rather than by widening the
-- declared return type to varchar, because `text` is what every caller in
-- src/ already believes it is receiving (src/lib/users/load.ts, StaffRow) and
-- because a length limit on the way OUT of a read-only function protects
-- nothing.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  role public.user_role,
  full_name text,
  phone text,
  lang text,
  active boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  return query
  select p.id, u.email::text, p.role, p.full_name, p.phone, p.lang, p.active,
         p.created_at, u.last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.active desc, p.role, lower(p.full_name), u.email;
end;
$$;

comment on function public.admin_list_users() is
  'A8''s staff list. Reads the sign-in address out of auth.users, which no client role can select from, and asserts app.is_admin() itself. auth.users.email is varchar(255) on Supabase and the cast to text is load-bearing — without it plpgsql raises 42804 (see 0025).';

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated, service_role;
