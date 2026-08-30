-- ─────────────────────────────────────────────────────────────────────────────
-- 0005 · Bookings — rentals AND admin blocks in one table
--
-- One table, a `kind` column, one exclusion constraint. This does two jobs:
--   1. a single guarantee protects every kind of hold on a car, and
--   2. a rep querying availability cannot tell a block from another rep's
--      booking, because there is nothing there to tell them apart with.
-- That second property is a requirement (docs/01-DECISIONS.md §8), achieved by
-- construction rather than by careful coding.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.booking_kind   as enum ('rental','block');
create type public.booking_status as enum ('booked','out','returned','cancelled','no_show','blocked');
create type public.pay_method     as enum ('cash','card','transfer');

create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique,         -- e.g. 2026-0417, shown to staff
  kind            public.booking_kind not null default 'rental',
  status          public.booking_status not null default 'booked',

  car_id          uuid not null references public.cars,
  category_id     uuid references public.categories,   -- snapshot at booking time
  hotel_id        uuid references public.hotels,
  room_number     text,

  start_date      date not null,
  end_date        date not null,
  pickup_at       timestamptz,                  -- default window 08:30–11:30, overridable
  dropoff_at      timestamptz,                  -- default window 18:00–21:00, overridable
  window_override boolean not null default false,

  -- customer (full driver detail, including additional drivers, lives in booking_drivers)
  cust_first      text,
  cust_last       text,
  cust_phone      text,
  cust_dob        date,
  cust_email      text,                         -- optional, captured at signing only

  -- money · integer cents, never floats · never visible to a rep who is neither
  -- the creator nor a rep of the booking's hotel
  period_id       uuid references public.pricing_periods,  -- snapshot: which table priced it
  days            smallint check (days is null or days >= 1),
  total_cents     integer check (total_cents is null or total_cents >= 0),
  collected_cents integer not null default 0 check (collected_cents >= 0),
  pay_method      public.pay_method,
  paid            boolean not null default false,

  block_reason    text,                         -- kind='block' only. ADMIN EYES ONLY.

  -- Eligibility is a hard block. Only the admin lifts it, and lifting it is
  -- recorded here and raised as an exception (docs/01-DECISIONS.md §11).
  eligibility_override_by uuid references public.profiles,
  eligibility_override_at timestamptz,

  created_by      uuid not null references public.profiles,
  returned_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  cash_handover_id uuid,                        -- FK added with cash_handovers

  check (end_date >= start_date),
  check ((kind = 'rental') = (status <> 'blocked')),
  constraint bookings_room_len   check (room_number is null or char_length(room_number) <= 16),
  constraint bookings_names_len  check (
    (cust_first is null or char_length(cust_first) <= 80) and
    (cust_last  is null or char_length(cust_last)  <= 80)),
  constraint bookings_phone_len  check (cust_phone is null or char_length(cust_phone) <= 32),
  constraint bookings_email_len  check (cust_email is null or char_length(cust_email) <= 254),
  -- A block is a bare hold on a car: no customer, no hotel, no money. A rental
  -- never carries a block reason. Both directions enforced here, so the
  -- "indistinguishable to a rep" rule cannot be broken by a stray write.
  constraint bookings_block_is_bare check (
    kind = 'rental' or (
      cust_first is null and cust_last is null and cust_phone is null and
      cust_dob is null and cust_email is null and hotel_id is null and
      room_number is null and period_id is null and total_cents is null and
      collected_cents = 0 and pay_method is null and paid = false)),
  constraint bookings_rental_has_no_block_reason check (
    kind = 'block' or block_reason is null)
);

-- ── THE guarantee ───────────────────────────────────────────────────────────
-- Inclusive range: a car is held through the whole of its final date, so
-- 12–15 Jul and 16–18 Jul may sit side by side, but 12–15 and 15–18 may not.
-- A failing insert here means the car is genuinely taken. Surface it to the
-- rep. NEVER weaken or drop this constraint to make something pass.
-- 'returned', 'cancelled' and 'no_show' fall outside the predicate, which is
-- exactly how an early return reopens the remaining dates.
alter table public.bookings add constraint no_double_booking
  exclude using gist (
    car_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('booked','out','blocked'));

create index on public.bookings (start_date, end_date);
create index on public.bookings (created_by);
create index on public.bookings (hotel_id);
create index on public.bookings (car_id, start_date);
create index on public.bookings (status) where status in ('booked','out','blocked');

-- Staff-facing reference, one counter per calendar year: 2026-0001, 2026-0002…
create table app.booking_ref_counters (
  year        smallint primary key,
  last_value  integer not null default 0
);

create or replace function app.next_booking_ref()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from app.today())::smallint;
  v_next integer;
begin
  insert into app.booking_ref_counters (year, last_value)
  values (v_year, 1)
  on conflict (year) do update set last_value = app.booking_ref_counters.last_value + 1
  returning last_value into v_next;

  return v_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;

-- ── Drivers ─────────────────────────────────────────────────────────────────
-- The main driver plus any additional drivers. Additional drivers are FREE
-- (docs/01-DECISIONS.md §9) and their licence is captured identically.
create table public.booking_drivers (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references public.bookings on delete cascade,
  is_main             boolean not null default false,
  first_name          text not null,
  last_name           text not null,
  dob                 date not null,
  licence_number      text,
  licence_country     text,
  licence_issued_on   date,
  licence_expires_on  date,
  front_image_path    text,          -- PRIVATE bucket. Signed URLs only, short TTL.
  back_image_path     text,
  ocr_confidence      numeric(3,2) check (ocr_confidence is null or ocr_confidence between 0 and 1),
  ocr_reviewed        boolean not null default false,
  images_purged_at    timestamptz,   -- set by the retention job
  created_at          timestamptz not null default now(),
  constraint booking_drivers_name_len check (
    char_length(first_name) between 1 and 80 and char_length(last_name) between 1 and 80),
  constraint booking_drivers_licence_len check (
    licence_number is null or char_length(licence_number) <= 40),
  constraint booking_drivers_country_len check (
    licence_country is null or char_length(licence_country) between 2 and 3)
);

create index on public.booking_drivers (booking_id);
create unique index booking_drivers_one_main on public.booking_drivers (booking_id) where is_main;

create type public.seat_type as enum ('infant','child','booster');

-- Baby seats are free. They exist so the rep knows to put one in the car —
-- they add nothing to the total, ever.
create table public.booking_extras (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings on delete cascade,
  seat          public.seat_type not null,
  qty           smallint not null default 1 check (qty between 1 and 4),
  unique (booking_id, seat)
);
