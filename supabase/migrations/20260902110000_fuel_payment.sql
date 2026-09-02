-- ═════════════════════════════════════════════════════════════════════════════
-- 0031 · The rep takes the fuel money, so the app has to know they hold it
--
-- 0030 made the fuel shortfall a real charge — computed by the database at the
-- moment of return, on `bookings.fuel_charge`. It stopped there: the figure was
-- displayed and nothing could record that anybody had paid it. The owner
-- confirmed (2 Sep 2026) what actually happens at the desk — **the rep takes
-- the fuel money from the customer**, in person, when the car comes back.
--
-- That makes this cash, and cash in this app is not just a number on a booking:
-- §7 shows a rep the one aggregate they are allowed, "today's own cash in
-- hand", and §31 makes the boss's confirmation what clears it. Fuel money the
-- app does not know about is money a rep is holding that never appears in that
-- figure and is never handed over — the reconciliation quietly goes wrong,
-- which is worse than not collecting it at all.
--
-- IT LIVES ON THE RETURN HANDOVER, NOT ON THE BOOKING, and that is the whole
-- design. Rental cash is a fact about a booking: `bookings.collected`, taken by
-- `created_by` at the pickup. Fuel cash is a fact about an EVENT — the moment
-- the car came back and money crossed the desk — and the row describing that
-- event already carries both things this needs and neither of which the
-- booking has:
--
--   · WHO. `handovers.by_profile`. Rental cash is attributed to whoever made
--     the booking; fuel cash is taken by whoever processed the return, which
--     is routinely somebody else — reps cover for each other (§8) and the
--     guest hands the keys to whoever is on the desk.
--   · WHEN. `handovers.occurred_at`. A rental picked up on Monday can come
--     back on Friday: its rental cash is Monday's and its fuel cash is
--     Friday's, and §7's figure is a day's takings.
--
-- Putting them on `bookings` instead would also have meant fighting
-- app.bookings_before_write(), which refuses any rep-context write to a
-- returned booking (IR108) — and fuel cash is by definition on a returned one.
-- `handovers` carries no such guard, because a handover is a record of
-- something that happened rather than a live thing to be edited.
--
-- Kept as columns rather than a general payments ledger. A ledger is where this
-- ends up if incident charges ever become collectable too — but they are not
-- (§15 takes no deposit and there is no card on file, so a guest who has flown
-- home cannot be charged at all), and rebuilding the cash system around a table
-- on the strength of a case that does not exist yet would be rebuilding it
-- twice.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.handovers
  add column fuel_collected integer not null default 0
    check (fuel_collected >= 0),
  add column fuel_pay_method public.pay_method,
  add column fuel_cash_handover_id uuid references public.cash_handovers,
  -- Structural rather than a trigger: there is no such thing as fuel money at
  -- a pickup, so the pickup row cannot carry any. This is also what stops a
  -- rep parking an amount somewhere to inflate the figure they will later be
  -- asked to hand over — there is nowhere to park it.
  add constraint handovers_fuel_money_on_return check (
    kind = 'return' or (fuel_collected = 0 and fuel_pay_method is null)
  );

create index on public.handovers (fuel_cash_handover_id);

comment on column public.handovers.fuel_collected is
  'What the rep actually took for the fuel shortfall at this return. Deliberately free to differ from bookings.fuel_charge: a guest who argued it down, or paid nothing, is a fact the boss should see rather than a state the app refuses to record.';
comment on column public.handovers.fuel_pay_method is
  'How the fuel shortfall was paid. Only ''cash'' reaches a rep''s cash in hand — a card or a transfer was never in their pocket.';
comment on column public.handovers.fuel_cash_handover_id is
  'The hand-over that covered this return''s fuel cash — a different day, and often a different rep, from the one that covered the booking''s rental cash (0031). In no client grant: public.my_hand_over_cash() is the only writer.';

-- ── Narrowing what a rep may write on a handover ────────────────────────────
-- 0011 granted `select, insert, update` on `handovers` at the TABLE level, so
-- every column was writable by any session that could read the booking. That
-- was survivable while a handover held only a fuel reading and some notes.
-- It is not survivable now: this migration makes `by_profile` and
-- `occurred_at` decide WHOSE cash a payment is and WHICH DAY it belongs to, so
-- a table-wide update grant would let a rep re-attribute their takings to a
-- colleague, or move them to a day the boss has already settled.
--
-- Revoked and re-granted column by column. The list is exactly what the app
-- writes — src/lib/handover/fuel.ts updates the reading and the notes, and the
-- return screen adds the two money columns — so nothing legitimate loses a
-- door, and `by_profile`, `occurred_at`, `kind` and `booking_id` become
-- insert-time facts that no later statement can revise.
revoke update on public.handovers from authenticated;

grant select (fuel_collected, fuel_pay_method, fuel_cash_handover_id)
  on public.handovers to authenticated;
grant update (fuel_eighths, notes, fuel_collected, fuel_pay_method)
  on public.handovers to authenticated;

-- INSERT is still table-wide, and `by_profile` is chosen by the client there.
-- A rep who wrote a colleague's id into it would be posting their own takings
-- into somebody else's figure — hiding cash, not giving it away — so the one
-- column that decides attribution is settled here instead of being trusted.
-- An admin is exempt: the boss records handovers on a rep's behalf (§30).
create or replace function app.handovers_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.by_profile := coalesce(auth.uid(), new.by_profile);
  else
    new.by_profile  := old.by_profile;
    new.occurred_at := old.occurred_at;
    new.kind        := old.kind;
    new.booking_id  := old.booking_id;
  end if;

  return new;
end;
$$;

revoke all on function app.handovers_before_write() from public;

create trigger handovers_guard
  before insert or update on public.handovers
  for each row execute function app.handovers_before_write();

-- ── §7's one aggregate, now counting both streams ───────────────────────────
-- Each function below gains a second term with the same shape as the first and
-- three differences, all of them from the header: it reads the RETURN handover
-- rather than the pickup one, attributes by that handover's own `by_profile`
-- rather than by `bookings.created_by`, and dates it by that handover's own
-- `occurred_at`. Written as two scalar sub-selects added together rather than
-- as a UNION over one shape: the two streams genuinely have different
-- predicates, and forcing them into one query is how the difference gets lost
-- the next time somebody edits it.

create or replace function public.my_cash_in_hand()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_total integer;
begin
  perform app.assert_staff();

  if auth.uid() is null then
    return 0;
  end if;

  select
    coalesce((
      select sum(b.collected)
      from public.bookings b
      join public.handovers h
        on h.booking_id = b.id and h.kind = 'pickup'
      left join public.cash_handovers ch
        on ch.id = b.cash_handover_id
      where b.created_by = auth.uid()
        and b.kind = 'rental'
        and b.pay_method = 'cash'
        and (b.cash_handover_id is null or ch.confirmed_by is null)
        and (h.occurred_at at time zone 'Europe/Athens')::date = app.today()
    ), 0)
    +
    coalesce((
      select sum(h.fuel_collected)
      from public.handovers h
      left join public.cash_handovers ch
        on ch.id = h.fuel_cash_handover_id
      where h.kind = 'return'
        and h.by_profile = auth.uid()
        and h.fuel_pay_method = 'cash'
        and (h.fuel_cash_handover_id is null or ch.confirmed_by is null)
        and (h.occurred_at at time zone 'Europe/Athens')::date = app.today()
    ), 0)
  into v_total;

  return v_total;
end;
$$;

create or replace function public.my_cash_ready_to_hand_over()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_total integer;
begin
  perform app.assert_staff();

  if auth.uid() is null then
    return 0;
  end if;

  select
    coalesce((
      select sum(b.collected)
      from public.bookings b
      join public.handovers h
        on h.booking_id = b.id and h.kind = 'pickup'
      where b.created_by = auth.uid()
        and b.kind = 'rental'
        and b.pay_method = 'cash'
        and b.cash_handover_id is null
        and (h.occurred_at at time zone 'Europe/Athens')::date = app.today()
    ), 0)
    +
    coalesce((
      select sum(h.fuel_collected)
      from public.handovers h
      where h.kind = 'return'
        and h.by_profile = auth.uid()
        and h.fuel_pay_method = 'cash'
        and h.fuel_cash_handover_id is null
        and (h.occurred_at at time zone 'Europe/Athens')::date = app.today()
    ), 0)
  into v_total;

  return v_total;
end;
$$;

-- One movement, both streams. The two sets are stamped with the SAME
-- cash_handovers row, because it is one envelope of cash going across one desk
-- — what makes them two columns is which day and which rep each was earned by,
-- not that they travel separately once handed over.
drop function public.my_hand_over_cash();

create function public.my_hand_over_cash()
returns table (handover_id uuid, amount integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_booking_ids uuid[];
  v_rental     integer;
  v_return_ids uuid[];
  v_fuel       integer;
  v_total      integer;
  v_handover   uuid;
begin
  perform app.assert_staff();

  if v_actor is null then
    raise exception using errcode = 'IR001', message = 'not authorised';
  end if;

  select array_agg(b.id), coalesce(sum(b.collected), 0)
    into v_booking_ids, v_rental
  from public.bookings b
  join public.handovers h
    on h.booking_id = b.id and h.kind = 'pickup'
  where b.created_by = v_actor
    and b.kind = 'rental'
    and b.pay_method = 'cash'
    and b.cash_handover_id is null
    and (h.occurred_at at time zone 'Europe/Athens')::date = app.today();

  select array_agg(h.id), coalesce(sum(h.fuel_collected), 0)
    into v_return_ids, v_fuel
  from public.handovers h
  where h.kind = 'return'
    and h.by_profile = v_actor
    and h.fuel_pay_method = 'cash'
    and h.fuel_cash_handover_id is null
    and (h.occurred_at at time zone 'Europe/Athens')::date = app.today();

  v_total := coalesce(v_rental, 0) + coalesce(v_fuel, 0);

  if v_total <= 0 then
    raise exception using errcode = 'IR114', message = 'nothing to hand over';
  end if;

  insert into public.cash_handovers (rep_id, amount)
  values (v_actor, v_total)
  returning id into v_handover;

  -- `= any(null)` matches nothing, so a rep with only fuel cash today — or
  -- only rental cash — needs no branch here.
  update public.bookings
     set cash_handover_id = v_handover
   where id = any (v_booking_ids);

  update public.handovers
     set fuel_cash_handover_id = v_handover
   where id = any (v_return_ids);

  return query select v_handover, v_total;
end;
$$;

comment on function public.my_hand_over_cash() is
  'Hands over the calling rep''s own cash in hand for today, in one movement: the rental cash they took at their pickups and the fuel cash they took at their returns (0031). Takes no amount and no booking set — both are read from the same predicates my_cash_in_hand() reports on (docs/01-DECISIONS.md §7).';

revoke all on function public.my_hand_over_cash() from public;
grant execute on function public.my_hand_over_cash() to authenticated, service_role;
