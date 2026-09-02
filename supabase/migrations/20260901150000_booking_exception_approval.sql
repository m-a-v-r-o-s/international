-- ═════════════════════════════════════════════════════════════════════════════
-- 0028 · Exception bookings wait for the boss, and the guest gets an email
--
-- Two changes, bundled because the second only makes sense once the first
-- exists.
--
-- 1. §9 used to read "email — optional, asked only at the signing step". The
--    owner now wants it at booking time, checked, and used to send the guest a
--    confirmation with their pickup time, return time, cost and licence
--    requirements the moment a rep books them (application code:
--    src/lib/email/booking-confirmation.ts). That is all in TypeScript —
--    `bookings.cust_email` already existed and was already grantable, so
--    nothing here changes for it.
--
-- 2. What DOES need the database is the escape hatch that goes with making
--    email newly required: a rep can still tick "exception booking" and send
--    it with no verified email (or, as already true, an out-of-window
--    pick-up) — but the owner does not want that half-checked booking acting
--    like an ordinary one anywhere else in the app while it is unreviewed. So
--    `pickup_exception = true` now starts the row in `exception_status =
--    'pending'`, a state this migration threads through:
--
--      · the car is still held — 'pending' is not in the set of statuses the
--        no-double-booking exclusion constraint or availability() ignore, so
--        nothing here touches either one;
--      · it is filtered out of the screens that tell a rep or the boss what
--        is actually happening today (rep_day_movements, and the TypeScript
--        loaders for R1/A1 — see src/lib/movements/data.ts);
--      · it cannot be picked up — a new hard block beside the eligibility one
--        already on this same transition;
--      · and it only ever leaves 'pending' through the two new admin-only
--        RPCs below, which is the manager approving or denying it. Denying
--        cancels the row outright, which is what actually frees the car back
--        up — 'pending' alone was never what held it.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.bookings
  add column exception_status text
    check (exception_status in ('pending', 'approved', 'denied'));

-- Never out of step with the flag it exists for: an exception booking always
-- has a status, an ordinary one never does. Both sides of this are enforced
-- again below by the trigger that derives the column — this is the belt, that
-- is the braces.
alter table public.bookings
  add constraint bookings_exception_status_matches_flag
    check (
      (pickup_exception and exception_status is not null)
      or (not pickup_exception and exception_status is null)
    );

/*
 * Extends app.bookings_enforce_pickup_window() (20260901130000) with the
 * derivation. Placed here rather than in a third trigger because it already
 * runs on every insert/update and already reads `new.pickup_exception` for
 * the window gate — a second function reading the same column to decide the
 * same "is this an exception booking" question would be two places that could
 * one day disagree.
 *
 * The rule: pickup_exception going from false (or absent, on INSERT) to true
 * always (re)starts the row at 'pending' — a rep cannot revive a denied
 * booking by re-ticking the box, nor keep an approved one's approval by
 * accident. Once it is already true and stays true, this function leaves
 * `new.exception_status` exactly as the write already set it: a rep has no
 * grant on the column at all (see below), so an ordinary rep edit carries the
 * old value forward untouched by SQL's own semantics, and the two admin RPCs
 * below set it explicitly in the same statement — which this must not
 * overwrite, or approving one would be undone by the trigger that fires on
 * the very same write.
 */
create or replace function app.bookings_enforce_pickup_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'block' then
    new.exception_status := null;
  elsif not new.pickup_exception then
    new.exception_status := null;
  elsif tg_op = 'INSERT' or not old.pickup_exception then
    new.exception_status := 'pending';
  end if;

  if new.kind <> 'block'
     and not new.pickup_exception
     and app.outside_default_windows(new.pickup_at, null) then
    raise exception using errcode = 'IR116',
      message = 'pick-up is outside the manager''s window and no exception was recorded';
  end if;
  return new;
end;
$$;

-- Read-only to a rep — never in their insert or update grant. Whatever they
-- send for it is not even reached: the trigger above overwrites `new` before
-- storage, exactly as it already does for category_id and days.
grant select (exception_status) on public.bookings to authenticated;

/*
 * app.bookings_before_write(), re-created from 20260830110000 with one
 * addition: a pending exception booking cannot start (booked → out), the same
 * shape as the eligibility hard block two lines below it and for the same
 * reason — a rule with no UI path around it, no route handler that could
 * forget to call it, and no distinction between a rep and an admin, because
 * the admin's own way past it is approving the booking, not overriding the
 * pickup.
 */
create or replace function app.bookings_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin  boolean := app.is_admin();
  v_actor     uuid    := auth.uid();
  v_category  uuid;
  v_old_cat   uuid;
  v_period    uuid;
  v_total     integer;
  v_reprice   boolean := false;
begin
  -- ── INSERT ──────────────────────────────────────────────────────────────
  if tg_op = 'INSERT' then
    if not v_is_admin then
      -- A rep creates plain rentals, as themselves, in 'booked', at the price
      -- the server works out. Everything else they might send is dropped here.
      new.kind            := 'rental';
      new.status          := 'booked';
      new.created_by      := coalesce(v_actor, new.created_by);
      new.block_reason    := null;
      new.period_id       := null;
      new.days            := null;
      new.total            := null;
      new.collected        := 0;
      new.pay_method      := null;
      new.paid            := false;
      new.returned_at     := null;
      new.cash_handover_id := null;
    end if;

    if new.kind = 'block' then
      new.status := 'blocked';
    end if;

    if new.ref is null or new.ref = '' then
      new.ref := app.next_booking_ref();
    end if;

    if exists (select 1 from public.cars c
               where c.id = new.car_id and c.archived_at is not null) then
      raise exception using errcode = 'IR107', message = 'car is archived';
    end if;

    if new.kind = 'rental' then
      new.category_id := app.category_of_car(new.car_id);
      new.days := app.rental_days(new.start_date, new.end_date);

      -- The price comes from the engine. An admin may type a total instead —
      -- that is the only way a price is ever set by hand, and it is audited.
      if new.total is null then
        select q.period_id, q.total into v_period, v_total
        from public.quote(new.category_id, new.start_date, new.end_date) q;
        new.period_id   := v_period;
        new.total       := v_total;
      end if;
    else
      new.category_id := null;
      new.days        := null;
    end if;

    return new;
  end if;

  -- ── UPDATE ──────────────────────────────────────────────────────────────
  new.id         := old.id;
  new.ref        := old.ref;
  new.kind       := old.kind;
  new.created_at := old.created_at;
  new.updated_at := now();

  if not v_is_admin then
    new.created_by       := old.created_by;
    new.block_reason     := old.block_reason;
    new.eligibility_override_by := old.eligibility_override_by;
    new.eligibility_override_at := old.eligibility_override_at;
    new.period_id        := old.period_id;
    new.total            := old.total;

    -- `cash_handover_id` is the ONE derived field a rep's own action moves,
    -- and only in one direction: from null to a `cash_handovers` row that
    -- belongs to them. Anything else — re-pointing a booking at a different
    -- handover, clearing one, or claiming somebody else's — is reverted, the
    -- same as every other privileged field above. The column is still absent
    -- from the rep's UPDATE grant, so the only caller that reaches this at all
    -- is public.my_hand_over_cash(), which is SECURITY DEFINER and computes
    -- both sides itself.
    if new.cash_handover_id is distinct from old.cash_handover_id
       and (old.cash_handover_id is not null
            or new.cash_handover_id is null
            or not exists (select 1 from public.cash_handovers ch
                           where ch.id = new.cash_handover_id and ch.rep_id = v_actor))
    then
      new.cash_handover_id := old.cash_handover_id;
    end if;

    -- Once a rental is closed it is the boss's business, not the rep's.
    if old.status in ('returned','cancelled','no_show','blocked') then
      raise exception using errcode = 'IR108', message = 'booking is closed';
    end if;

    if old.status = 'out' then
      -- After pickup a rep may do exactly three things: extend the return date,
      -- swap to another car in the same category as part of that extension, and
      -- process the return (docs/01-DECISIONS.md §18).
      if new.status not in ('out','returned') then
        raise exception using errcode = 'IR109', message = 'transition not allowed';
      end if;

      if new.end_date < old.end_date then
        raise exception using errcode = 'IR110', message = 'a rental in progress cannot be shortened';
      end if;

      if new.car_id is distinct from old.car_id
         and app.category_of_car(new.car_id) is distinct from old.category_id then
        raise exception using errcode = 'IR111', message = 'swap car must be in the same category';
      end if;

      new.start_date      := old.start_date;
      new.hotel_id        := old.hotel_id;
      new.room_number     := old.room_number;
      new.cust_first      := old.cust_first;
      new.cust_last       := old.cust_last;
      new.cust_phone      := old.cust_phone;
      new.cust_dob        := old.cust_dob;
      new.pickup_at       := old.pickup_at;
      new.collected        := old.collected;
      new.pay_method      := old.pay_method;
      new.paid            := old.paid;
    else
      -- Before pickup: edit anything on the booking, or cancel it.
      if new.status not in ('booked','out','cancelled','no_show') then
        raise exception using errcode = 'IR109', message = 'transition not allowed';
      end if;
    end if;
  end if;

  if new.status = 'returned' and new.returned_at is null then
    new.returned_at := now();
  end if;

  -- ── The hard blocks ─────────────────────────────────────────────────────
  -- A pending exception booking cannot start. This is the boss's approval
  -- gate (docs/01-DECISIONS.md, "Exception bookings wait for the boss"): the
  -- only way past it is public.admin_approve_exception_booking(), never a
  -- rep action and never an admin override on the pickup itself.
  if new.kind = 'rental'
     and new.status = 'out' and old.status <> 'out'
     and new.exception_status = 'pending' then
    raise exception using errcode = 'IR123', message = 'exception booking is awaiting manager approval';
  end if;

  -- A failing driver cannot be picked up (docs/01-DECISIONS.md §11). This sits
  -- on the booked → out transition rather than in the UI, so there is no route
  -- handler, no screen and no direct API call that can get around it. It
  -- applies to the admin too: the way past it is
  -- public.admin_override_eligibility(), which records the override and raises
  -- it as an exception for the boss.
  if new.kind = 'rental'
     and new.status = 'out' and old.status <> 'out'
     and new.eligibility_override_at is null then
    perform app.assert_drivers_eligible(new.id, new.category_id, new.start_date, new.end_date);
  end if;

  if new.car_id is distinct from old.car_id
     and exists (select 1 from public.cars c
                 where c.id = new.car_id and c.archived_at is not null) then
    raise exception using errcode = 'IR107', message = 'car is archived';
  end if;

  if new.kind = 'rental' then
    v_reprice := (new.start_date is distinct from old.start_date)
              or (new.end_date   is distinct from old.end_date)
              or (new.car_id     is distinct from old.car_id);

    new.days := app.rental_days(new.start_date, new.end_date);

    if new.car_id is distinct from old.car_id then
      new.category_id := app.category_of_car(new.car_id);
    end if;

    -- Re-price when the shape of the rental changed — including an extension,
    -- which still uses the ORIGINAL pickup date's period. If an admin typed a
    -- new total themselves, theirs stands.
    if v_reprice and new.total is not distinct from old.total then
      select q.period_id, q.total into v_period, v_total
      from public.quote(new.category_id, new.start_date, new.end_date) q;
      new.period_id   := v_period;
      new.total       := v_total;
    end if;
  end if;

  return new;
end;
$$;

-- ── The boss's two ways out of 'pending' ────────────────────────────────────

create or replace function public.admin_approve_exception_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  update public.bookings
     set exception_status = 'approved'
   where id = p_booking_id
     and pickup_exception
     and exception_status = 'pending';

  if not found then
    raise exception using errcode = 'IR112', message = 'no pending exception booking with that id';
  end if;
end;
$$;

comment on function public.admin_approve_exception_booking(uuid) is
  'The boss clears a pending exception booking to run like any other. Leaves the car held exactly as it already was.';

-- Denying cancels the row outright rather than leaving 'denied' sitting on a
-- booking still shaped like a live one — cancelling is what actually frees
-- the car, through the same exclusion-constraint predicate every other
-- cancellation does, and it is the one existing status a rep already
-- understands to mean "this did not happen".
create or replace function public.admin_deny_exception_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  update public.bookings
     set exception_status = 'denied',
         status = 'cancelled'
   where id = p_booking_id
     and pickup_exception
     and exception_status = 'pending'
     and status = 'booked';

  if not found then
    raise exception using errcode = 'IR112', message = 'no pending exception booking with that id';
  end if;
end;
$$;

comment on function public.admin_deny_exception_booking(uuid) is
  'The boss refuses a pending exception booking. Cancels it in the same move, which is what frees the car back up for other reps.';

revoke all on function public.admin_approve_exception_booking(uuid) from public;
revoke all on function public.admin_deny_exception_booking(uuid) from public;
grant execute on function public.admin_approve_exception_booking(uuid) to authenticated, service_role;
grant execute on function public.admin_deny_exception_booking(uuid) to authenticated, service_role;

-- ── The admin queue itself ──────────────────────────────────────────────────
-- Same shape as public.rep_day_movements(): a narrow SECURITY DEFINER read
-- rather than widening bookings_select, because the columns a pending queue
-- needs (the reason, the guest, the room) are already visible to the boss
-- through the ordinary policy — this exists to give one settled list, not to
-- expose anything new.
create or replace function public.admin_pending_exception_bookings()
returns table (
  booking_id uuid,
  ref text,
  plate text,
  hotel_name text,
  room_number text,
  guest text,
  pickup_at timestamptz,
  reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  return query
  select b.id, b.ref, c.plate, h.name, b.room_number,
         nullif(trim(coalesce(b.cust_first, '') || ' ' || coalesce(b.cust_last, '')), ''),
         b.pickup_at, b.pickup_exception_reason
  from public.bookings b
  join public.cars c on c.id = b.car_id
  left join public.hotels h on h.id = b.hotel_id
  where b.kind = 'rental' and b.exception_status = 'pending'
  order by b.pickup_at nulls last, b.created_at;
end;
$$;

revoke all on function public.admin_pending_exception_bookings() from public;
grant execute on function public.admin_pending_exception_bookings() to authenticated, service_role;

-- ── Keep the rep off a booking that is not live yet ─────────────────────────
-- rep_day_movements() (20260830190000) is what both the push digests and R1's
-- fallback read from; excluding 'pending' here is the one place that keeps a
-- rep from being told to go pick up a car the boss has not cleared yet.
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
    and b.exception_status is distinct from 'pending'
    and (b.start_date = p_on or b.end_date = p_on)
    and (
      b.created_by = p_profile_id
      or b.hotel_id in (select hr.hotel_id from public.hotel_reps hr
                        where hr.profile_id = p_profile_id)
    )
  order by 1 desc, 3 nulls last, 4;
end;
$$;
