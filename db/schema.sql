-- International Rentals — reference schema (draft for the implementing agent)
-- Postgres / Supabase. Money is integer whole euros — never cents/decimals.
-- Dates are date, not timestamp, wherever the business rule is "a day is
-- morning to night".

create extension if not exists btree_gist;

-- ─────────────────────────────────────────────────────────── people & places

create type user_role as enum ('admin','rep');

create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  role          user_role not null default 'rep',
  full_name     text not null,
  phone         text,
  lang          text not null default 'el' check (lang in ('el','en')),
  pin_hash      text,                       -- argon2id, set by the rep on their device
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table hotels (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  area          text,
  address       text,
  active        boolean not null default true
);

-- a rep's home hotel, and any hotel they cover. Drives the "both can see it" rule.
create table hotel_reps (
  hotel_id      uuid not null references hotels on delete cascade,
  profile_id    uuid not null references profiles on delete cascade,
  is_primary    boolean not null default true,
  primary key (hotel_id, profile_id)
);

-- ──────────────────────────────────────────────────────────────────── fleet

create table categories (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,        -- 'A' … 'H'
  name_el       text not null,
  name_en       text not null,
  min_driver_age smallint not null,          -- 21 for A,B — 23 for C..H. Editable.
  min_licence_years smallint not null default 1,
  sort_order    smallint not null
);

create table car_models (
  id            uuid primary key default gen_random_uuid(),
  make          text not null,
  model         text not null,
  category_id   uuid not null references categories,
  transmission  text not null check (transmission in ('manual','automatic')),
  fuel_type     text not null check (fuel_type in ('petrol','diesel','hybrid','electric')),
  seats         smallint not null,
  doors         smallint not null,
  tank_litres   numeric(5,1),
  photo_path    text
);

create table cars (
  id            uuid primary key default gen_random_uuid(),
  plate         text not null unique,
  model_id      uuid not null references car_models,
  year          smallint,
  colour        text,
  photo_path    text,
  notes         text,                        -- admin only
  archived_at   timestamptz,                 -- archived cars leave availability entirely
  created_at    timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────── pricing

create table pricing_periods (
  id            uuid primary key default gen_random_uuid(),
  season_year   smallint not null,
  name          text not null,               -- 'Low start', 'Peak', …
  start_date    date not null,
  end_date      date not null,
  check (end_date >= start_date),
  -- periods within one season may not overlap
  exclude using gist (
    season_year with =,
    daterange(start_date, end_date, '[]') with &&
  )
);

create table price_rows (
  period_id     uuid not null references pricing_periods on delete cascade,
  category_id   uuid not null references categories,
  days          smallint not null check (days between 1 and 7),
  total         integer not null check (total >= 0),
  primary key (period_id, category_id, days)
);

create table price_extra_day (
  period_id     uuid not null references pricing_periods on delete cascade,
  category_id   uuid not null references categories,
  price         integer not null check (price >= 0),
  primary key (period_id, category_id)
);

-- ───────────────────────────────────────────────────────────────── bookings

create type booking_kind   as enum ('rental','block');
create type booking_status as enum ('booked','out','returned','cancelled','no_show','blocked');
create type pay_method     as enum ('cash','card','transfer');

create table bookings (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique,         -- e.g. 2026-0417, shown to staff
  kind            booking_kind not null default 'rental',
  status          booking_status not null default 'booked',

  car_id          uuid not null references cars,
  category_id     uuid references categories,   -- snapshot at booking time
  hotel_id        uuid references hotels,
  room_number     text,

  start_date      date not null,
  end_date        date not null,
  pickup_at       timestamptz,                  -- default 08:30–11:30, ENFORCED (see below)
  dropoff_at      timestamptz,                  -- default 18:00–21:00, freely overridable
  window_override boolean not null default false,
  pickup_exception        boolean not null default false,  -- ADMIN-flagged, required to pass the window guard
  pickup_exception_reason text,                             -- required together with the flag above

  -- customer (main driver detail lives in booking_drivers)
  cust_first      text,
  cust_last       text,
  cust_phone      text,
  cust_dob        date,
  cust_email      text,                         -- optional, captured at signing only

  -- money (never visible to a rep other than the owner/hotel rep)
  period_id       uuid references pricing_periods,   -- snapshot: which table priced it
  days            smallint,
  total           integer,
  collected       integer not null default 0,
  pay_method      pay_method,
  paid            boolean not null default false,

  block_reason    text,                         -- kind='block' only. ADMIN EYES ONLY.

  created_by      uuid not null references profiles,
  returned_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  check (end_date >= start_date),
  check ((kind = 'rental') = (status <> 'blocked'))
);

-- THE guarantee. Do not remove. Inclusive range: a car is held through its final date.
alter table bookings add constraint no_double_booking
  exclude using gist (
    car_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('booked','out','blocked'));

create index on bookings (start_date, end_date);
create index on bookings (created_by);
create index on bookings (hotel_id);
create index on bookings (car_id, start_date);

-- drivers: main + any free additional drivers
create table booking_drivers (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references bookings on delete cascade,
  is_main             boolean not null default false,
  first_name          text not null,
  last_name           text not null,
  dob                 date not null,
  licence_number      text,
  licence_country     text,
  licence_issued_on   date,
  licence_expires_on  date,
  front_image_path    text,          -- PRIVATE bucket. Signed URLs only.
  back_image_path     text,
  ocr_confidence      numeric(3,2),
  ocr_reviewed        boolean not null default false,
  images_purged_at    timestamptz    -- set by the retention job
);

create type seat_type as enum ('infant','child','booster');

create table booking_extras (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings on delete cascade,
  seat          seat_type not null,
  qty           smallint not null default 1 check (qty > 0)
);

-- ───────────────────────────────────────────────────── handover & condition

create table handovers (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings on delete cascade,
  kind          text not null check (kind in ('pickup','return')),
  occurred_at   timestamptz not null default now(),
  by_profile    uuid not null references profiles,
  fuel_eighths  smallint check (fuel_eighths between 0 and 8),
  notes         text,
  unique (booking_id, kind)
);

create table damage_marks (
  id            uuid primary key default gen_random_uuid(),
  handover_id   uuid not null references handovers on delete cascade,
  car_id        uuid not null references cars,
  view          text not null check (view in ('front','rear','left','right','top')),
  x             numeric(5,4) not null,     -- 0..1 relative to the diagram
  y             numeric(5,4) not null,
  mark_type     text not null check (mark_type in ('scratch','dent','chip','crack','other')),
  note          text,
  photo_path    text,
  pre_existing  boolean not null default false
);

create table contracts (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings on delete cascade,
  pdf_path      text not null,
  signature_path text not null,
  signed_at     timestamptz not null default now(),
  signer_name   text not null,
  emailed_to    text,
  emailed_at    timestamptz,
  version       smallint not null default 1
);

-- ─────────────────────────────────────────────── exceptions, cash, auditing

create type exception_type as enum
  ('fuel_short','new_damage','late_return','no_show','eligibility_override','other');

create table exceptions (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings on delete cascade,
  type          exception_type not null,
  detail        text,
  raised_by     uuid references profiles,
  raised_at     timestamptz not null default now(),
  resolved_by   uuid references profiles,
  resolved_at   timestamptz,
  charge        integer,                   -- the boss's decision. Rep never sets this.
  resolution    text
);

-- "today's cash in hand" — the ONLY aggregate a rep may see
create table cash_handovers (
  id            uuid primary key default gen_random_uuid(),
  rep_id        uuid not null references profiles,
  amount        integer not null,
  handed_at     timestamptz not null default now(),
  confirmed_by  uuid references profiles   -- admin confirms receipt
);

alter table bookings add column cash_handover_id uuid references cash_handovers;

create table audit_log (
  id            bigserial primary key,
  actor_id      uuid references profiles,
  entity        text not null,
  entity_id     uuid,
  action        text not null,
  before        jsonb,
  after         jsonb,
  at            timestamptz not null default now()
);
create index on audit_log (entity, entity_id, at desc);

create table app_settings (
  id                      smallint primary key default 1 check (id = 1),
  licence_retention_months smallint not null default 24,
  pickup_window            text not null default '08:30-11:30',
  dropoff_window           text not null default '18:00-21:00',
  company jsonb not null default '{}'::jsonb   -- legal name, ΑΦΜ, address, contract T&Cs
);

create table push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles on delete cascade,
  endpoint      text not null unique,
  keys          jsonb not null,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────  RLS
-- Every table: enable RLS. Nothing is readable by default.
-- Policies are written in db/policies.sql — see 03-SECURITY.md for the matrix.
-- The ONLY way a rep learns another car is occupied is availability(), which is
-- SECURITY DEFINER and returns car_id + dates and absolutely nothing else.
