-- ═════════════════════════════════════════════════════════════════════════════
-- 0018 · A8 · Users and hotels
--
-- A8 is the pilot blocker: without it the boss cannot create the two reps the
-- October test build is for. Four gaps, all probed against the running schema
-- before anything here was written (docs/06-IMPLEMENTATION-NOTES.md).
--
-- 1. NOTHING CAN CREATE A REP, and nothing here can either. `auth.users` is
--    GoTrue's table, not ours: an insert into it is 42501 for `authenticated`
--    AND for `service_role`, and PostgREST does not expose the `auth` schema
--    at all. So the account itself is minted through the GoTrue Admin API with
--    the service-role key, from the server — a NEW CATEGORY of service-role
--    use, recorded in the notes. What that key can mint is deliberately inert:
--    app.handle_new_user() forces the new profile to role 'rep', and a 'rep'
--    with no `hotel_reps` row can read nothing but their own profile. Every
--    privileged step after account creation — the role, the active flag, the
--    hotel assignments — still goes through this schema and is still checked
--    by app.is_admin() in the database.
--
-- 2. THE BOSS CANNOT SEE THE ADDRESS A REP SIGNS IN WITH. `profiles` has no
--    email column, `auth.users` is unreachable, and public.role_for_email()
--    is granted to service_role only and answers the opposite question. A8 has
--    to show it — it is the one thing the boss hands over — so
--    public.admin_list_users() below is the same shape as role_for_email():
--    SECURITY DEFINER, reading auth.users, asserting app.is_admin() itself.
--
-- 3. A REP COULD BE PRIMARY AT TWO HOTELS. docs/01-DECISIONS.md §3: "Each rep
--    is stationed at one hotel." Nothing enforced it — the admin could insert
--    two `hotel_reps` rows with is_primary = true and the database took both,
--    which makes "their own hotel" (R3's default) an ambiguous question with
--    no answer. A partial unique index settles it. Cover assignments stay
--    unlimited, which is the whole point of the cover-shift rule (§8).
--
-- 4. THE BOSS COULD SET A REP'S PIN. `grant update (full_name, phone, lang,
--    pin_hash) on public.profiles to authenticated` plus the
--    `profiles_update_admin` policy meant the admin could write pin_hash on
--    any row. The PIN is the second factor on a rep's own device and belongs
--    to the rep alone. app.profiles_before_write() restores it for any caller
--    who is not the row's owner. public.set_pin_hash() still works: it is
--    SECURITY DEFINER, called by the server on the service role, where
--    auth.uid() is null.
--
--   IR115  a rep is already stationed at another hotel
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 3. One home hotel per rep ───────────────────────────────────────────────
-- A partial index, so it constrains only the primary assignment. A rep may
-- cover any number of other hotels, and two reps may share a home hotel.
create unique index hotel_reps_one_primary_per_rep
  on public.hotel_reps (profile_id)
  where is_primary;

comment on index public.hotel_reps_one_primary_per_rep is
  'docs/01-DECISIONS.md §3: each rep is stationed at ONE hotel. Cover assignments (is_primary = false) are unlimited — that is the cover-shift rule in §8.';

-- ── 4. The PIN belongs to the rep whose device it unlocks ───────────────────
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

    -- Nobody sets somebody else's PIN. auth.uid() is null when the server acts
    -- on its own behalf through public.set_pin_hash(), which is the only
    -- writer that legitimately names a profile id other than the caller's.
    if auth.uid() is not null and auth.uid() is distinct from old.id then
      new.pin_hash := old.pin_hash;
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function app.profiles_before_write();

-- ── 2. The staff list, with the address each person signs in with ───────────
-- Admin only, and asserted here rather than trusted from the caller. `email`
-- comes from auth.users, which no client role can read; `last_sign_in_at` is
-- what tells the boss whether the password he handed a rep actually worked.
-- No pin_hash, no password hash, nothing GoTrue holds beyond those two facts.
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
  select p.id, u.email, p.role, p.full_name, p.phone, p.lang, p.active,
         p.created_at, u.last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.active desc, p.role, lower(p.full_name), u.email;
end;
$$;

comment on function public.admin_list_users() is
  'A8''s staff list. Reads the sign-in address out of auth.users, which no client role can select from, and asserts app.is_admin() itself.';

-- ── Hotel assignment, as one movement ───────────────────────────────────────
-- The insert and delete on `hotel_reps` are already admin-only through the
-- table policy, and A8 could have used them directly. It does not, because
-- MOVING a rep's home hotel is two writes that have to agree: the old primary
-- row has to go before the new one lands, or the index in this migration
-- rejects the pair. Doing that in the client would leave a rep with no hotel
-- if the second call failed — and a rep with no hotel silently loses sight of
-- their own hotel's bookings (docs/01-DECISIONS.md §8). One statement, one
-- transaction, one outcome.
create or replace function public.admin_set_home_hotel(p_profile_id uuid, p_hotel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_profile_id is null then
    raise exception using errcode = 'IR104', message = 'profile is required';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception using errcode = 'IR112', message = 'profile not found';
  end if;

  delete from public.hotel_reps hr
   where hr.profile_id = p_profile_id and hr.is_primary;

  if p_hotel_id is null then
    return;                       -- "no home hotel" is a legitimate state
  end if;

  if not exists (select 1 from public.hotels h where h.id = p_hotel_id) then
    raise exception using errcode = 'IR112', message = 'hotel not found';
  end if;

  -- A cover assignment for the same hotel becomes the home one rather than
  -- colliding with the composite primary key.
  insert into public.hotel_reps (hotel_id, profile_id, is_primary)
  values (p_hotel_id, p_profile_id, true)
  on conflict (hotel_id, profile_id) do update set is_primary = true;
end;
$$;

comment on function public.admin_set_home_hotel(uuid, uuid) is
  'Moves a rep''s home hotel in one transaction, so the unique index cannot leave them with none. Null clears it.';

-- Cover assignments are added and removed one at a time, and must never
-- silently displace the rep's home hotel.
create or replace function public.admin_set_cover(p_profile_id uuid, p_hotel_id uuid, p_covers boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_profile_id is null or p_hotel_id is null then
    raise exception using errcode = 'IR104', message = 'profile and hotel are required';
  end if;

  if p_covers then
    if exists (select 1 from public.hotel_reps hr
               where hr.profile_id = p_profile_id and hr.hotel_id = p_hotel_id
                 and hr.is_primary) then
      raise exception using errcode = 'IR115', message = 'this is already the rep''s home hotel';
    end if;

    insert into public.hotel_reps (hotel_id, profile_id, is_primary)
    values (p_hotel_id, p_profile_id, false)
    on conflict (hotel_id, profile_id) do nothing;
  else
    -- Only a cover row is removable here. Clearing a home hotel goes through
    -- admin_set_home_hotel(), so "remove this cover" can never be the click
    -- that unstations a rep.
    delete from public.hotel_reps hr
     where hr.profile_id = p_profile_id and hr.hotel_id = p_hotel_id
       and not hr.is_primary;
  end if;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_list_users()',
    'public.admin_set_home_hotel(uuid,uuid)',
    'public.admin_set_cover(uuid,uuid,boolean)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;
