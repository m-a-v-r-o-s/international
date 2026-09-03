-- ─────────────────────────────────────────────────────────────────────────────
-- 0034 · Bookings may also start at the office, or at a hotel not in the system
--
-- docs/01-DECISIONS.md §3 said "a location is a hotel". The business also rents
-- from its own office and, on occasion, from a guest's hotel that was never
-- registered here. Two different shapes, deliberately:
--
--   · The office is a fixed, staffed location — modelled as an ordinary row in
--     `hotels`, with real `hotel_reps`. Nothing here changes for that case; it
--     needs no schema change at all, only a row an admin adds through the
--     existing screen.
--   · A one-off hotel is not worth a permanent `hotels` row and has no rep
--     stationed at it, so it gets a free-text column instead:
--     `bookings.adhoc_hotel_name`. A booking may point at a registered hotel OR
--     name one, never both — `bookings_hotel_xor_adhoc` holds that apart.
--
-- Visibility for an ad-hoc-hotel booking is creator + admin only, and that costs
-- nothing new: `bookings_select`/`bookings_update` (20260830091100) already read
-- `hotel_id = any(app.my_hotel_ids())`, which is simply null when `hotel_id` is
-- null, leaving only the `created_by = auth.uid()` clause. See docs/01-DECISIONS.md
-- §41.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.bookings add column adhoc_hotel_name text;

alter table public.bookings add constraint bookings_adhoc_hotel_len
  check (adhoc_hotel_name is null or char_length(adhoc_hotel_name) between 1 and 160);

alter table public.bookings add constraint bookings_hotel_xor_adhoc
  check (hotel_id is null or adhoc_hotel_name is null);

-- A block is still a bare hold: no customer, no hotel, no money, and now no
-- ad-hoc hotel name either. Dropped and re-added because a CHECK body cannot be
-- altered in place.
alter table public.bookings drop constraint bookings_block_is_bare;
alter table public.bookings add constraint bookings_block_is_bare check (
  kind = 'rental' or (
    cust_first is null and cust_last is null and cust_phone is null and
    cust_dob is null and cust_email is null and hotel_id is null and
    adhoc_hotel_name is null and
    room_number is null and period_id is null and total is null and
    collected = 0 and pay_method is null and paid = false));

grant insert (adhoc_hotel_name) on public.bookings to authenticated;
grant update (adhoc_hotel_name) on public.bookings to authenticated;

-- ── The write guard carries it through a pickup the same way it already does
-- for hotel_id and room_number: a rep may set it on INSERT (ordinary column, no
-- forcing needed) but not change it once the car is `out`.
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
      new.adhoc_hotel_name := old.adhoc_hotel_name;
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
