-- ─────────────────────────────────────────────────────────────────────────────
-- 0003 · Fleet
-- ─────────────────────────────────────────────────────────────────────────────

create table public.categories (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,      -- 'A' … 'H'
  name_el           text not null,
  name_en           text not null,
  -- Editable per category by the admin. 21 for A/B and 23 for C–H is the
  -- CURRENT policy, not a law of nature — never hard-code it in app logic
  -- (docs/01-DECISIONS.md §11).
  min_driver_age    smallint not null check (min_driver_age between 16 and 99),
  min_licence_years smallint not null default 1 check (min_licence_years between 0 and 20),
  sort_order        smallint not null,
  constraint categories_code_len check (char_length(code) between 1 and 4)
);

create table public.car_models (
  id            uuid primary key default gen_random_uuid(),
  make          text not null,
  model         text not null,
  category_id   uuid not null references public.categories,
  transmission  text not null check (transmission in ('manual','automatic')),
  fuel_type     text not null check (fuel_type in ('petrol','diesel','hybrid','electric')),
  seats         smallint not null check (seats between 1 and 9),
  doors         smallint not null check (doors between 1 and 6),
  aircon        boolean not null default true,
  tank_litres   numeric(5,1) check (tank_litres is null or tank_litres > 0),
  photo_path    text,
  unique (make, model)
);

create index on public.car_models (category_id);

create table public.cars (
  id            uuid primary key default gen_random_uuid(),
  plate         text not null unique,
  model_id      uuid not null references public.car_models,
  year          smallint check (year is null or year between 1980 and 2100),
  colour        text,
  photo_path    text,
  notes         text,                        -- ADMIN EYES ONLY. Not granted to `authenticated`.
  archived_at   timestamptz,                 -- archived cars leave availability entirely
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint cars_plate_len check (char_length(plate) between 2 and 16)
);

create index on public.cars (model_id);
create index on public.cars (archived_at) where archived_at is null;

comment on column public.cars.notes is
  'Admin-only free text. The column grant to `authenticated` deliberately omits it.';
