-- ═════════════════════════════════════════════════════════════════════════════
-- 0019 · Deactivating an account actually deactivates it
--
-- GAP FOUND BUILDING A8, and the reason it was found there: "deactivate, never
-- delete" (docs/04-SCREENS.md A8) is the whole of that screen's answer to a
-- rep leaving, so it had to be tested, and the test showed it did not hold.
--
-- public.admin_set_user_active() sets profiles.active = false, and the app
-- boundary honours it — currentStaff() returns null and requireStaff()
-- redirects to /login. The DATABASE did not. `bookings_select` and
-- `bookings_update` read
--
--     created_by = auth.uid() or hotel_id = any (app.my_hotel_ids())
--
-- and neither branch asked whether the caller is still staff, while
-- app.my_hotel_ids() returned a deactivated rep's hotels unchanged. A JWT
-- issued before the deactivation stays valid until it expires — Supabase has
-- no way to be told otherwise, which docs/06-IMPLEMENTATION-NOTES.md already
-- flags — so for the life of that token a dismissed rep holding the anon key
-- and their own access token could, against PostgREST directly:
--
--   · read their own bookings AND every booking at the hotel they were
--     stationed at, which is another rep's guests;
--   · read those bookings' drivers, including licence_number, and their
--     handovers, damage marks, contracts and exceptions — every child table
--     goes through app.can_read_booking(), which had the same hole;
--   · reach the licence images in the private bucket, whose object policies
--     ask app.can_read_booking() the same question;
--   · and UPDATE a live booking. Verified, not theorised: the update returned
--     rows=1. Changing a guest's dates, room or status after being dismissed
--     is the worst thing on this list.
--
-- INSERT was already safe: app.bookings_before_write() reaches quote(), which
-- calls app.assert_staff() and raises IR001.
--
-- The fix is one predicate in three places, and it is deliberately not a new
-- mechanism. app.is_staff() already means "signed in, and still active" and is
-- already what the RPCs assert. app.is_admin() already checks `active` itself,
-- so the admin branch of every policy below is unchanged.
--
-- This makes profiles.active the single source of truth for whether a session
-- may do anything at all, which is why no GoTrue-side ban is added alongside
-- it: a second switch that could drift out of step with the first would make
-- "is this person still staff" a question with two answers.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── The hotels a rep covers, if they are still a rep ─────────────────────────
create or replace function app.my_hotel_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not app.is_staff() then '{}'::uuid[]
    else coalesce(
      (select array_agg(hr.hotel_id)
       from public.hotel_reps hr
       where hr.profile_id = auth.uid()),
      '{}'::uuid[])
  end
$$;

comment on function app.my_hotel_ids() is
  'The hotels this rep is stationed at or covers — empty for a deactivated account, so a JWT that outlives the deactivation carries no hotel with it.';

-- ── Readability of one booking ──────────────────────────────────────────────
-- Every child of a booking is gated on this function: booking_drivers,
-- booking_extras, handovers (through app.can_read_handover), damage_marks,
-- contracts, exceptions, and the objects in the private bucket. One line here
-- closes all of them at once, which is the reason the rule was written in one
-- place to begin with.
create or replace function app.can_read_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.is_admin() then exists (select 1 from public.bookings b where b.id = p_booking_id)
    when not app.is_staff() then false
    else exists (
      select 1
      from public.bookings b
      where b.id = p_booking_id
        and b.kind = 'rental'
        and (b.created_by = auth.uid() or b.hotel_id = any (app.my_hotel_ids()))
    )
  end
$$;

-- ── The two policies that inline the predicate rather than calling it ───────
drop policy bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated
  using (
    app.is_admin()
    or (app.is_staff()
        and kind = 'rental'
        and (created_by = auth.uid() or hotel_id = any (app.my_hotel_ids())))
  );

drop policy bookings_update on public.bookings;
create policy bookings_update on public.bookings
  for update to authenticated
  using (
    app.is_admin()
    or (app.is_staff()
        and kind = 'rental'
        and (created_by = auth.uid() or hotel_id = any (app.my_hotel_ids())))
  )
  with check (
    app.is_admin()
    or (app.is_staff()
        and kind = 'rental'
        and (created_by = auth.uid() or hotel_id = any (app.my_hotel_ids())))
  );

-- ── Money ───────────────────────────────────────────────────────────────────
-- The same shape, for the same reason. public.my_cash_in_hand() and
-- public.my_hand_over_cash() already assert staff themselves; this is the
-- table underneath them.
drop policy cash_handovers_select on public.cash_handovers;
create policy cash_handovers_select on public.cash_handovers
  for select to authenticated
  using (app.is_admin() or (app.is_staff() and rep_id = auth.uid()));

drop policy cash_handovers_insert on public.cash_handovers;
create policy cash_handovers_insert on public.cash_handovers
  for insert to authenticated
  with check (app.is_admin() or (app.is_staff() and rep_id = auth.uid()));
