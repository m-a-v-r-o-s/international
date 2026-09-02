-- ═════════════════════════════════════════════════════════════════════════════
-- 0033 · Only the boss makes an exception booking, so the queue goes
--
-- 0027 gave a rep an escape hatch out of the pick-up window. 0028 (§33) made
-- the same tick-box also waive the newly-required email, and — because a rep
-- was the one ticking it — parked the result in an approval queue for the
-- boss at /admin/exception-bookings.
--
-- The owner's decision, 2 Sep 2026: a rep does not get that hatch at all.
-- Booking outside the window, or without a checked email, is the boss's own
-- act. And once the person ticking the box is the person who would approve
-- it, the queue is a click he has already made — a state to review, two RPCs,
-- a hard block and a screen, all standing between him and a booking he made
-- deliberately.
--
-- So this migration removes the half of 0028 that existed to review somebody
-- else's exception, and keeps the half that says what an exception IS:
--
--   · `pickup_exception` and `pickup_exception_reason` stay, still requiring
--     each other (0027's CHECK is untouched). An exception booking is still a
--     fact on the row with a reason written beside it — what changed is who
--     may write it.
--   · A rep's write can no longer set either column. Not by revoking the
--     column grant — that is granted to `authenticated`, which is the admin
--     too, so revoking it would take the boss's own write with it — but the
--     way every other privileged field on this table is already handled:
--     app.bookings_before_write() overwrites what a non-admin sends, before
--     storage, on INSERT and on UPDATE, exactly as it does for `total`,
--     `block_reason` and `period_id`.
--   · `exception_status`, the two admin RPCs, the queue read and the IR123
--     block on pickup all go. A row still sitting in 'pending' when this runs
--     becomes an ordinary live booking, which is what the new rule says it
--     already was: the boss made it.
--
-- What a rep now meets instead of the tick-box is IR116 — "pick-up is outside
-- the manager's window" — which was always the true error; the hatch was what
-- let them past it.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── The flag becomes the admin's alone ──────────────────────────────────────
/*
 * app.bookings_before_write(), re-created from 20260901150000 with three
 * changes: a non-admin INSERT is forced to `pickup_exception = false` with no
 * reason, a non-admin UPDATE carries both columns forward from `old`, and the
 * IR123 pending-approval block is gone along with the column it read.
 *
 * The forcing has to happen HERE rather than in the window guard below,
 * because trigger order is what makes it work: bookings_guard runs first
 * (name order: guard → owner → pickup_window → window_override), so by the
 * time the window guard asks whether an exception was recorded, a rep's claim
 * to one has already been thrown away and the out-of-hours pick-up is
 * refused.
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
      -- The exception flag is the boss's alone (0033). A rep who posts it is
      -- not refused for it, only ignored — and then refused by the window
      -- guard trigger, with the error that is actually true: the pick-up is
      -- out of hours.
      new.pickup_exception        := false;
      new.pickup_exception_reason := null;
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
    -- Carried forward rather than cleared: an exception the boss made stays
    -- one when a rep later edits the room number, and a rep can neither tick
    -- the box nor untick the boss's.
    new.pickup_exception        := old.pickup_exception;
    new.pickup_exception_reason := old.pickup_exception_reason;

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

-- ── The window guard goes back to being only a gate ─────────────────────────
-- Re-created as 20260901130000 left it: 0028's `exception_status` derivation
-- is deleted with the column, and what remains is the original rule — an
-- out-of-window pick-up needs a recorded exception, which now only an admin
-- can have recorded.
create or replace function app.bookings_enforce_pickup_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'block'
     and not new.pickup_exception
     and app.outside_default_windows(new.pickup_at, null) then
    raise exception using errcode = 'IR116',
      message = 'pick-up is outside the manager''s window and no exception was recorded';
  end if;
  return new;
end;
$$;

-- ── The day stops hiding anything ───────────────────────────────────────────
-- rep_day_movements() re-created from 20260901150000 without the 'pending'
-- filter. An exception booking is live the moment the boss makes it, so it
-- belongs on the rep's Today screen and in the push digest like any other —
-- and it is exactly the booking a rep most needs told about, since the
-- pick-up is at an hour nobody would assume.
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

-- ── The approval machinery ──────────────────────────────────────────────────
-- Dropped rather than left unused: each of these asserts admin and would keep
-- working, on a column that is about to stop existing, for a screen that is
-- deleted in the same commit.
drop function if exists public.admin_approve_exception_booking(uuid);
drop function if exists public.admin_deny_exception_booking(uuid);
drop function if exists public.admin_pending_exception_bookings();

-- Last, because the three functions above and both triggers had to stop
-- reading it first. Dropping the column takes its CHECK constraint
-- (bookings_exception_status_matches_flag) and its column grant with it.
alter table public.bookings drop column exception_status;
