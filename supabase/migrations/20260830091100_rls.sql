-- ═════════════════════════════════════════════════════════════════════════════
-- 0011 · Row Level Security
--
-- RLS is the product here, not a feature. One rep must not be able to see
-- another rep's business, and that is enforced in Postgres — the UI merely
-- reflects it. The realistic attacker is a logged-in rep with dev tools open
-- and a valid session, so nothing below assumes the client is honest.
--
-- Two mechanisms, used for two different jobs:
--   · POLICIES decide which ROWS a caller may touch.
--   · COLUMN GRANTS hide the handful of fields that must never reach a rep's
--     device at all — cars.notes, bookings.block_reason, exceptions.charge_cents
--     and the price columns. Admins reach those through the SECURITY DEFINER
--     RPCs in the next migration, because an admin holds the same `authenticated`
--     database role as a rep and a grant cannot tell them apart.
--
-- NOTE for anyone writing queries: because of those column grants, `select *`
-- will be refused on cars, bookings and exceptions. Name the columns you need —
-- which is the house rule anyway (docs/03-SECURITY.md, "API responses trimmed").
-- ═════════════════════════════════════════════════════════════════════════════

-- Start from nothing. Supabase grants `anon` and `authenticated` broad access to
-- new tables in `public` by default; we withdraw it and hand back only what each
-- role needs, column by column where it matters.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;

alter table public.profiles           enable row level security;
alter table public.hotels             enable row level security;
alter table public.hotel_reps         enable row level security;
alter table public.rep_devices        enable row level security;
alter table public.categories         enable row level security;
alter table public.car_models         enable row level security;
alter table public.cars               enable row level security;
alter table public.pricing_periods    enable row level security;
alter table public.price_rows         enable row level security;
alter table public.price_extra_day    enable row level security;
alter table public.bookings           enable row level security;
alter table public.booking_drivers    enable row level security;
alter table public.booking_extras     enable row level security;
alter table public.handovers          enable row level security;
alter table public.damage_marks       enable row level security;
alter table public.contracts          enable row level security;
alter table public.exceptions         enable row level security;
alter table public.cash_handovers     enable row level security;
alter table public.audit_log          enable row level security;
alter table public.app_settings       enable row level security;
alter table public.push_subscriptions enable row level security;

-- ── profiles ────────────────────────────────────────────────────────────────
-- A rep sees their own row and nobody else's — not another rep's name, not
-- their hotel, nothing. `pin_hash` is granted to no one; only the server, on
-- the service role, ever touches it. `role` and `active` are not updatable by
-- anybody through this grant, so no session can promote itself to admin.
grant select (id, role, full_name, phone, lang, active, created_at, updated_at)
  on public.profiles to authenticated;
grant update (full_name, phone, lang, pin_hash) on public.profiles to authenticated;

create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or app.is_admin());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ── hotels ──────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.hotels to authenticated;

create policy hotels_select on public.hotels
  for select to authenticated
  using (app.is_admin() or id = any (app.my_hotel_ids()));

create policy hotels_admin_write on public.hotels
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ── hotel_reps ──────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.hotel_reps to authenticated;

create policy hotel_reps_select on public.hotel_reps
  for select to authenticated
  using (profile_id = auth.uid() or app.is_admin());

create policy hotel_reps_admin_write on public.hotel_reps
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ── rep_devices ─────────────────────────────────────────────────────────────
-- Session binding is server business. No client role is granted anything.
create policy rep_devices_admin_read on public.rep_devices
  for select to authenticated
  using (app.is_admin());

-- ── categories & models ─────────────────────────────────────────────────────
-- Specs and the eligibility minimums are needed by every rep on every pickup.
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.car_models to authenticated;

create policy categories_select on public.categories
  for select to authenticated using (true);
create policy categories_admin_write on public.categories
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

create policy car_models_select on public.car_models
  for select to authenticated using (true);
create policy car_models_admin_write on public.car_models
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- ── cars ────────────────────────────────────────────────────────────────────
-- Every rep may look up any car's specs. `notes` is admin-only and is left out
-- of the grant entirely; archived cars disappear for reps.
grant select (id, plate, model_id, year, colour, photo_path, archived_at, created_at, updated_at)
  on public.cars to authenticated;
grant insert (plate, model_id, year, colour, photo_path, archived_at) on public.cars to authenticated;
grant update (plate, model_id, year, colour, photo_path, archived_at) on public.cars to authenticated;
grant delete on public.cars to authenticated;

create policy cars_select on public.cars
  for select to authenticated
  using (archived_at is null or app.is_admin());

create policy cars_admin_insert on public.cars
  for insert to authenticated with check (app.is_admin());
create policy cars_admin_update on public.cars
  for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy cars_admin_delete on public.cars
  for delete to authenticated using (app.is_admin());

-- ── pricing ─────────────────────────────────────────────────────────────────
-- No rep policy exists on any of these three tables, so a rep selecting from
-- them gets an empty set no matter what filter they send. The price of the
-- booking in front of them arrives through quote(), one number at a time.
grant select, insert, update, delete on public.pricing_periods to authenticated;
grant select, insert, update, delete on public.price_rows to authenticated;
grant select, insert, update, delete on public.price_extra_day to authenticated;

create policy pricing_periods_admin on public.pricing_periods
  for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy price_rows_admin on public.price_rows
  for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy price_extra_day_admin on public.price_extra_day
  for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- ── bookings ────────────────────────────────────────────────────────────────
-- The heart of it. A rep reads a RENTAL they created or one belonging to a
-- hotel they cover, and never a BLOCK — blocks reach them only as anonymous
-- occupied dates from availability().
--
-- The insert and update grants deliberately omit `kind`, `ref`, `created_by`,
-- `days`, `category_id`, `period_id`, `total_cents`, `block_reason`,
-- `returned_at` and `cash_handover_id`: every one of those is derived or
-- privileged, and is set by app.bookings_before_write() rather than accepted
-- from a client. A rep POSTing `total_cents` therefore fails the privilege
-- check outright, and even if it were granted the trigger would overwrite it.
grant select (id, ref, kind, status, car_id, category_id, hotel_id, room_number,
              start_date, end_date, pickup_at, dropoff_at, window_override,
              cust_first, cust_last, cust_phone, cust_dob, cust_email,
              period_id, days, total_cents, collected_cents, pay_method, paid,
              created_by, returned_at, created_at, updated_at, cash_handover_id,
              eligibility_override_by, eligibility_override_at)
  on public.bookings to authenticated;

grant insert (car_id, hotel_id, room_number, start_date, end_date,
              pickup_at, dropoff_at, window_override,
              cust_first, cust_last, cust_phone, cust_dob, cust_email)
  on public.bookings to authenticated;

grant update (car_id, hotel_id, room_number, start_date, end_date,
              pickup_at, dropoff_at, window_override,
              cust_first, cust_last, cust_phone, cust_dob, cust_email,
              status, collected_cents, pay_method, paid)
  on public.bookings to authenticated;

grant delete on public.bookings to authenticated;

create policy bookings_select on public.bookings
  for select to authenticated
  using (
    app.is_admin()
    or (kind = 'rental'
        and (created_by = auth.uid() or hotel_id = any (app.my_hotel_ids())))
  );

create policy bookings_insert on public.bookings
  for insert to authenticated
  with check (
    app.is_admin()
    or (kind = 'rental' and created_by = auth.uid() and app.is_staff())
  );

create policy bookings_update on public.bookings
  for update to authenticated
  using (
    app.is_admin()
    or (kind = 'rental'
        and (created_by = auth.uid() or hotel_id = any (app.my_hotel_ids())))
  )
  with check (
    app.is_admin()
    or (kind = 'rental'
        and (created_by = auth.uid() or hotel_id = any (app.my_hotel_ids())))
  );

create policy bookings_delete_admin on public.bookings
  for delete to authenticated using (app.is_admin());

-- ── booking children ────────────────────────────────────────────────────────
create or replace function app.can_read_handover(p_handover_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_read_booking((select h.booking_id from public.handovers h where h.id = p_handover_id))
$$;

grant execute on function app.can_read_handover(uuid) to authenticated, service_role;

grant select, insert, update, delete on public.booking_drivers to authenticated;
create policy booking_drivers_rw on public.booking_drivers
  for all to authenticated
  using (app.can_read_booking(booking_id))
  with check (app.can_read_booking(booking_id));

grant select, insert, update, delete on public.booking_extras to authenticated;
create policy booking_extras_rw on public.booking_extras
  for all to authenticated
  using (app.can_read_booking(booking_id))
  with check (app.can_read_booking(booking_id));

grant select, insert, update on public.handovers to authenticated;
create policy handovers_rw on public.handovers
  for all to authenticated
  using (app.can_read_booking(booking_id))
  with check (app.can_read_booking(booking_id));

grant select, insert, update, delete on public.damage_marks to authenticated;
create policy damage_marks_rw on public.damage_marks
  for all to authenticated
  using (app.can_read_handover(handover_id))
  with check (app.can_read_handover(handover_id));

grant select, insert on public.contracts to authenticated;
create policy contracts_select on public.contracts
  for select to authenticated using (app.can_read_booking(booking_id));
create policy contracts_insert on public.contracts
  for insert to authenticated with check (app.can_read_booking(booking_id));

-- ── exceptions ──────────────────────────────────────────────────────────────
-- The rep records the evidence and flags it. They never price it and never
-- close it, so `charge_cents` and `resolution` are not in the grant at all.
grant select (id, booking_id, type, detail, raised_by, raised_at, resolved_at)
  on public.exceptions to authenticated;
grant insert (booking_id, type, detail, raised_by) on public.exceptions to authenticated;

create policy exceptions_select on public.exceptions
  for select to authenticated using (app.can_read_booking(booking_id));

create policy exceptions_insert on public.exceptions
  for insert to authenticated
  with check (app.can_read_booking(booking_id) and raised_by = auth.uid());

-- ── cash ────────────────────────────────────────────────────────────────────
grant select (id, rep_id, amount_cents, handed_at) on public.cash_handovers to authenticated;
grant insert (rep_id, amount_cents) on public.cash_handovers to authenticated;

create policy cash_handovers_select on public.cash_handovers
  for select to authenticated
  using (rep_id = auth.uid() or app.is_admin());

create policy cash_handovers_insert on public.cash_handovers
  for insert to authenticated
  with check (rep_id = auth.uid() or app.is_admin());

-- ── audit log ───────────────────────────────────────────────────────────────
-- Admin-readable, nobody-writable. The triggers write it as the table owner.
grant select on public.audit_log to authenticated;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated using (app.is_admin());

-- ── settings ────────────────────────────────────────────────────────────────
-- Default pickup/drop-off windows and the company details that print on the
-- contract. Nothing financial, nothing cross-rep.
grant select, update on public.app_settings to authenticated;
create policy app_settings_select on public.app_settings
  for select to authenticated using (true);
create policy app_settings_admin_update on public.app_settings
  for update to authenticated using (app.is_admin()) with check (app.is_admin());

-- ── push ────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.push_subscriptions to authenticated;
create policy push_own on public.push_subscriptions
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
