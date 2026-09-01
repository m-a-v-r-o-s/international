-- ═════════════════════════════════════════════════════════════════════════════
-- 0028 · The boss's confirmation is what clears a rep's cash figure
--
-- The owner's ask (docs/01-DECISIONS.md §31): a rep hands physical cash to him
-- at the end of a shift — almost always the morning shift, occasionally again
-- at night when a late pickup or a delayed payment leaves something over — and
-- only HE should be able to zero what a rep is shown as still owing.
--
-- That was not what public.my_hand_over_cash() did. It is SECURITY DEFINER and
-- callable by the rep alone, and the moment a rep called it, the bookings it
-- covered were stamped with a cash_handover_id, which is the ONLY thing
-- public.my_cash_in_hand() excludes. So the rep's own tap cleared the rep's
-- own figure, in full, on the spot — admin_confirm_cash_handover() existed and
-- stamped `confirmed_by`, but nothing downstream ever looked at that column.
-- It recorded a receipt; it did not gate anything. (No screen called it either
-- — see the new A12 admin page this migration's app-layer half adds.)
--
-- The fix leaves the two-write shape of my_hand_over_cash() exactly as it was
-- — a rep still cannot name an amount or a booking set, still cannot confirm
-- their own receipt, still cannot touch `cash_handover_id` by any door but
-- that function. What changes is which predicate my_cash_in_hand() reports on:
-- a booking now leaves the rep's figure only once the handover it is stamped
-- with has been confirmed. A rep's tap still records the claim and still stops
-- that cash counting toward a SECOND hand-over (my_hand_over_cash() only ever
-- grabs `cash_handover_id is null` bookings, unchanged) — but the money stays
-- on the rep's own screen, visibly still theirs, until the boss says otherwise.
--
-- That splits "today's cash" into two amounts a rep needs to tell apart:
-- what is still sitting with them (grabbable by another tap) and what they
-- already handed over but the boss has not yet confirmed. Showing only the
-- combined total and letting a second tap fail with IR114 would be a rep
-- being told "nothing to hand over" while still looking at a nonzero number —
-- so my_cash_ready_to_hand_over() reports the first amount on its own, exactly
-- the predicate my_hand_over_cash() acts on, the same discipline
-- my_cash_in_hand() already followed. Both are the rep's own money; neither is
-- a new category of aggregate under §7.
-- ═════════════════════════════════════════════════════════════════════════════

-- "Today's cash in hand" now means: collected today, on the rep's own
-- pickups, and not yet CONFIRMED received by the boss — whether or not the
-- rep has already tapped "hand over". See the header above for why.
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

  select coalesce(sum(b.collected_cents), 0)
    into v_total
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
  ;

  return v_total;
end;
$$;

comment on function public.my_cash_in_hand() is
  'Today''s cash the rep is still accountable for: collected on their own pickups and not yet CONFIRMED by the boss (docs/01-DECISIONS.md §7, §31) — a rep''s own "hand over" tap no longer clears this on its own.';

-- The part of that figure a tap on "hand over" would actually grab right now
-- — exactly my_hand_over_cash()'s own predicate, reported rather than acted
-- on, so a screen can tell "still owing, waiting on the boss" apart from
-- "there is new cash to hand over" without guessing from one combined number.
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

  select coalesce(sum(b.collected_cents), 0)
    into v_total
  from public.bookings b
  join public.handovers h
    on h.booking_id = b.id and h.kind = 'pickup'
  where b.created_by = auth.uid()
    and b.kind = 'rental'
    and b.pay_method = 'cash'
    and b.cash_handover_id is null
    and (h.occurred_at at time zone 'Europe/Athens')::date = app.today();

  return v_total;
end;
$$;

comment on function public.my_cash_ready_to_hand_over() is
  'The slice of my_cash_in_hand() a tap on "hand over" would grab right now — cash_handover_id still null. Zero here with my_cash_in_hand() still positive means: already handed over, waiting on the boss to confirm.';

revoke all on function public.my_cash_in_hand() from public;
revoke all on function public.my_cash_ready_to_hand_over() from public;
grant execute on function public.my_cash_in_hand() to authenticated, service_role;
grant execute on function public.my_cash_ready_to_hand_over() to authenticated, service_role;

-- A12 · Cash (docs/04-SCREENS.md) — the boss's queue of receipts nobody has
-- confirmed yet. `confirmed_by` is withheld from `authenticated` by column
-- grant like every other admin-only figure in this schema (charge_cents,
-- block_reason, …), so the admin needs a narrow door to it same as A6's
-- admin_exception_detail() — a plain `select` on cash_handovers still cannot
-- see who has and hasn't confirmed, admin included.
create or replace function public.admin_pending_cash_handovers()
returns table (
  id uuid,
  rep_id uuid,
  rep_name text,
  amount_cents integer,
  handed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  return query
    select ch.id, ch.rep_id, p.full_name, ch.amount_cents, ch.handed_at
    from public.cash_handovers ch
    join public.profiles p on p.id = ch.rep_id
    where ch.confirmed_by is null
    order by ch.handed_at asc;
end;
$$;

comment on function public.admin_pending_cash_handovers() is
  'A12: every cash_handovers receipt no admin has confirmed yet, oldest first. Admin only.';

revoke all on function public.admin_pending_cash_handovers() from public;
grant execute on function public.admin_pending_cash_handovers() to authenticated, service_role;
