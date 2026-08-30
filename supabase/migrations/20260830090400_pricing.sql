-- ─────────────────────────────────────────────────────────────────────────────
-- 0004 · Pricing tables
--
-- The admin types TOTALS. The +€5 first-day premium is already inside those
-- numbers — the app performs no arithmetic of its own beyond the 8+ day
-- extension (docs/01-DECISIONS.md §6).
-- ─────────────────────────────────────────────────────────────────────────────

create table public.pricing_periods (
  id            uuid primary key default gen_random_uuid(),
  season_year   smallint not null check (season_year between 2020 and 2100),
  name          text not null,               -- 'Low start', 'Peak', …
  start_date    date not null,
  end_date      date not null,
  created_at    timestamptz not null default now(),
  check (end_date >= start_date),
  constraint pricing_periods_name_len check (char_length(name) between 1 and 60),
  -- Periods within one season may not overlap. Inclusive range: a period covers
  -- its final date.
  exclude using gist (
    season_year with =,
    daterange(start_date, end_date, '[]') with &&
  )
);

create index on public.pricing_periods using gist (daterange(start_date, end_date, '[]'));

-- category × period × duration → the total the admin typed. Durations 1–7 only;
-- 8+ days is the 7-day total plus price_extra_day.
create table public.price_rows (
  period_id     uuid not null references public.pricing_periods on delete cascade,
  category_id   uuid not null references public.categories,
  days          smallint not null check (days between 1 and 7),
  total_cents   integer not null check (total_cents >= 0),
  primary key (period_id, category_id, days)
);

create table public.price_extra_day (
  period_id     uuid not null references public.pricing_periods on delete cascade,
  category_id   uuid not null references public.categories,
  cents         integer not null check (cents >= 0),
  primary key (period_id, category_id)
);
