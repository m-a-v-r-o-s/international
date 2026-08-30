-- ═════════════════════════════════════════════════════════════════════════════
-- 0015 · my_hand_over_cash()
--
-- Gap found building R1's footer strip (docs/04-SCREENS.md): "cash in hand
-- today + Hand over action", the ONE aggregate a rep is allowed to see
-- (docs/01-DECISIONS.md §7). The reading half already worked. The handing-over
-- half could not be completed by a rep at all.
--
-- public.my_cash_in_hand() counts cash collected today on the rep's own
-- pickups `where b.cash_handover_id is null`, so handing over means two writes
-- that have to agree: a row in `cash_handovers`, and that row's id stamped on
-- the bookings it covers. A rep can do the first — the insert is granted and
-- the policy allows `rep_id = auth.uid()`. They cannot do the second:
-- `bookings.cash_handover_id` is absent from their UPDATE grant (42501) and
-- app.bookings_before_write() reverted it for a non-admin in any case. The
-- observable result was a "Hand over" button that recorded a receipt and left
-- the figure on the rep's screen unchanged for ever.
--
-- Fixed the same way staff_hotels() was, and for the same reason: a narrow
-- SECURITY DEFINER function that does the whole thing for the CALLER and
-- nobody else, rather than widening a grant or a policy. The rep still cannot
-- write the column, still cannot name an amount, and still cannot hand over
-- another rep's cash — the function reads both the amount and the set of
-- bookings itself, from the same predicate my_cash_in_hand() reports on, so
-- the two can never disagree.
--
-- The guard trigger is re-created below with one carve-out: a non-admin may
-- move `cash_handover_id` from null to a `cash_handovers` row that is their
-- own, once. Every other field it protects is untouched, and the direction is
-- one-way, so a stamped booking cannot be un-stamped back into today's figure.
--
--   IR114  nothing to hand over
-- ═════════════════════════════════════════════════════════════════════════════

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
      new.total_cents     := null;
      new.collected_cents := 0;
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
      if new.total_cents is null then
        select q.period_id, q.total_cents into v_period, v_total
        from public.quote(new.category_id, new.start_date, new.end_date) q;
        new.period_id   := v_period;
        new.total_cents := v_total;
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
    new.total_cents      := old.total_cents;

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
      new.collected_cents := old.collected_cents;
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

  -- ── The hard block ──────────────────────────────────────────────────────
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
    if v_reprice and new.total_cents is not distinct from old.total_cents then
      select q.period_id, q.total_cents into v_period, v_total
      from public.quote(new.category_id, new.start_date, new.end_date) q;
      new.period_id   := v_period;
      new.total_cents := v_total;
    end if;
  end if;

  return new;
end;
$$;


-- The rep's own cash, handed over in one movement. No parameters: an amount
-- the client could name would be an amount the client could get wrong, and the
-- set of bookings is not the client's business either.
create or replace function public.my_hand_over_cash()
returns table (handover_id uuid, amount_cents integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_ids      uuid[];
  v_total    integer;
  v_handover uuid;
begin
  perform app.assert_staff();

  if v_actor is null then
    raise exception using errcode = 'IR001', message = 'not authorised';
  end if;

  -- Exactly the predicate public.my_cash_in_hand() reports on: this rep's own
  -- bookings, paid in cash, picked up today in Athens time, not yet handed
  -- over. Written once here so the button can never hand over a different set
  -- of bookings from the figure printed above it.
  select array_agg(b.id), coalesce(sum(b.collected_cents), 0)
    into v_ids, v_total
  from public.bookings b
  join public.handovers h
    on h.booking_id = b.id and h.kind = 'pickup'
  where b.created_by = v_actor
    and b.kind = 'rental'
    and b.pay_method = 'cash'
    and b.cash_handover_id is null
    and (h.occurred_at at time zone 'Europe/Athens')::date = app.today();

  if v_ids is null or v_total <= 0 then
    raise exception using errcode = 'IR114', message = 'nothing to hand over';
  end if;

  insert into public.cash_handovers (rep_id, amount_cents)
  values (v_actor, v_total)
  returning id into v_handover;

  update public.bookings
     set cash_handover_id = v_handover
   where id = any (v_ids);

  return query select v_handover, v_total;
end;
$$;

comment on function public.my_hand_over_cash() is
  'Hands over the calling rep''s own cash in hand for today, in one movement. Takes no amount and no booking ids: both are read from the same predicate my_cash_in_hand() reports on (docs/01-DECISIONS.md §7).';

revoke all on function public.my_hand_over_cash() from public;
grant execute on function public.my_hand_over_cash() to authenticated, service_role;
