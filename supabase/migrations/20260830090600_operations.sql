-- ─────────────────────────────────────────────────────────────────────────────
-- 0006 · Handover, condition, contract, exceptions, cash
-- ─────────────────────────────────────────────────────────────────────────────

-- Fuel in eighths. No odometer, no km, no mileage — explicitly out of scope
-- (docs/01-DECISIONS.md §12). Fuel policy is same-to-same.
create table public.handovers (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings on delete cascade,
  kind          text not null check (kind in ('pickup','return')),
  occurred_at   timestamptz not null default now(),
  by_profile    uuid not null references public.profiles,
  fuel_eighths  smallint check (fuel_eighths between 0 and 8),
  notes         text,
  constraint handovers_notes_len check (notes is null or char_length(notes) <= 2000),
  unique (booking_id, kind)
);

create index on public.handovers (booking_id);
create index on public.handovers (occurred_at);

create table public.damage_marks (
  id            uuid primary key default gen_random_uuid(),
  handover_id   uuid not null references public.handovers on delete cascade,
  car_id        uuid not null references public.cars,
  view          text not null check (view in ('front','rear','left','right','top')),
  x             numeric(5,4) not null check (x between 0 and 1),   -- relative to the diagram
  y             numeric(5,4) not null check (y between 0 and 1),
  mark_type     text not null check (mark_type in ('scratch','dent','chip','crack','other')),
  note          text,
  photo_path    text,
  -- Marks recorded at pickup carry forward; anything new at return is flagged.
  pre_existing  boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint damage_marks_note_len check (note is null or char_length(note) <= 500)
);

create index on public.damage_marks (handover_id);
create index on public.damage_marks (car_id);

create table public.contracts (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings on delete cascade,
  pdf_path       text not null,
  signature_path text not null,
  signed_at      timestamptz not null default now(),
  signer_name    text not null,
  emailed_to     text,
  emailed_at     timestamptz,
  version        smallint not null default 1,
  constraint contracts_signer_len check (char_length(signer_name) between 1 and 160)
);

create index on public.contracts (booking_id);

-- ── The boss's inbox ────────────────────────────────────────────────────────
-- Anything non-standard lands here. The rep records the evidence and flags it;
-- they never price it, never argue it, never collect it (docs/01-DECISIONS.md §14).
create type public.exception_type as enum
  ('fuel_short','new_damage','late_return','no_show','eligibility_override','other');

create table public.exceptions (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings on delete cascade,
  type          public.exception_type not null,
  detail        text,
  raised_by     uuid references public.profiles,
  raised_at     timestamptz not null default now(),
  resolved_by   uuid references public.profiles,
  resolved_at   timestamptz,
  charge_cents  integer check (charge_cents is null or charge_cents >= 0),  -- the boss's call
  resolution    text,
  constraint exceptions_detail_len check (detail is null or char_length(detail) <= 2000)
);

create index on public.exceptions (booking_id);
create index on public.exceptions (resolved_at) where resolved_at is null;

comment on column public.exceptions.charge_cents is
  'Set by the admin only, through public.admin_resolve_exception(). Not granted to `authenticated`.';

-- "Today's cash in hand" — the ONE aggregate a rep may see, and only their own.
create table public.cash_handovers (
  id            uuid primary key default gen_random_uuid(),
  rep_id        uuid not null references public.profiles,
  amount_cents  integer not null check (amount_cents >= 0),
  handed_at     timestamptz not null default now(),
  confirmed_by  uuid references public.profiles   -- admin confirms receipt
);

create index on public.cash_handovers (rep_id, handed_at);

alter table public.bookings
  add constraint bookings_cash_handover_fk
  foreign key (cash_handover_id) references public.cash_handovers;

create index on public.bookings (cash_handover_id);
