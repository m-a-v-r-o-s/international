-- ═════════════════════════════════════════════════════════════════════════════
-- Gratis behind a code (docs/01-DECISIONS.md §48)
--
-- The manager account is shared, and gratis is shown only after a keyboard
-- shortcut and a 4-digit code. The code's hash lives here, alone, rather than
-- on app_settings: that table is readable by every signed-in user and every
-- change to it lands in the audit log. This one has no grant for anyone but
-- the service role and no audit trigger, the same as profiles.pin_hash being
-- redacted from the log.
-- ═════════════════════════════════════════════════════════════════════════════

create table public.gratis_lock (
  id         smallint primary key default 1 check (id = 1),
  code_hash  text not null,
  updated_at timestamptz not null default now()
);

alter table public.gratis_lock enable row level security;
revoke all on public.gratis_lock from public, anon, authenticated;
grant select, insert, update on public.gratis_lock to service_role;

-- Gratis now closes a booking the same way Paid does, so a waived balance
-- reads as settled wherever `paid` is shown, and only A14, unlocked, tells the
-- two apart. Income is still only ever settled_amount where settlement = 'paid'.
create or replace function public.admin_settle_pay_after(
  p_booking_id uuid,
  p_outcome text,
  p_method public.pay_method default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  if p_outcome is null or p_outcome not in ('paid','gratis')
     or (p_outcome = 'paid') <> coalesce(p_method in ('cash','card'), false)
     or (p_outcome = 'gratis' and p_method is not null) then
    raise exception using errcode = 'IR104', message = 'paid takes cash or card, gratis takes nothing';
  end if;

  update public.bookings b
     set settlement     = p_outcome,
         settled_amount = b.total - b.collected,
         settled_method = p_method,
         settled_by     = auth.uid(),
         settled_at     = now(),
         paid           = true
   where b.id = p_booking_id
     and b.kind = 'rental'
     and b.pay_after
     and b.settlement is null
     and b.status in ('out','returned');

  if not found then
    raise exception using errcode = 'IR126', message = 'no open balance on that booking';
  end if;
end;
$$;

/*
 * §48: what a locked manager browser leaves out of every list and history
 * screen. Waived AND returned: while the car is still out the rental stays in
 * sight, because its return still has to be processed.
 */
create function public.admin_hidden_waived_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();
  return query
    select b.id from public.bookings b
    where b.settlement = 'gratis' and b.status = 'returned';
end;
$$;

revoke all on function public.admin_hidden_waived_ids() from public;
grant execute on function public.admin_hidden_waived_ids() to authenticated, service_role;
