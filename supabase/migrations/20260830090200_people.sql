-- ─────────────────────────────────────────────────────────────────────────────
-- 0002 · People and places
-- ─────────────────────────────────────────────────────────────────────────────

create type public.user_role as enum ('admin','rep');

create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  role          public.user_role not null default 'rep',
  full_name     text not null default '',
  phone         text,
  lang          text not null default 'el' check (lang in ('el','en')),
  pin_hash      text,                       -- argon2id, set by the rep on their device
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_full_name_len check (char_length(full_name) <= 120),
  constraint profiles_phone_len     check (phone is null or char_length(phone) <= 32)
);

comment on column public.profiles.pin_hash is
  'argon2id hash of the device unlock PIN. Never leaves the server.';

create table public.hotels (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  area          text,
  address       text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint hotels_name_len check (char_length(name) between 1 and 160)
);

-- A rep's home hotel, plus any hotel they cover. Drives the "the creating rep AND
-- the hotel's rep can both see it" rule (docs/01-DECISIONS.md §8).
create table public.hotel_reps (
  hotel_id      uuid not null references public.hotels on delete cascade,
  profile_id    uuid not null references public.profiles on delete cascade,
  is_primary    boolean not null default true,
  primary key (hotel_id, profile_id)
);

create index on public.hotel_reps (profile_id);

-- A rep gets one device (docs/01-DECISIONS.md §1). The admin gets as many
-- concurrent sessions as they like, so admins are simply never bound here.
create table public.rep_devices (
  profile_id    uuid primary key references public.profiles on delete cascade,
  device_id     text not null,
  user_agent    text,
  bound_at      timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  constraint rep_devices_device_id_len check (char_length(device_id) between 16 and 128)
);

-- New user → profile row. Role always starts as 'rep'; only an admin can lift it
-- (public.admin_set_user_role), so a self-signup can never mint an admin.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, lang)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), ''),
    case when new.raw_user_meta_data->>'lang' = 'en' then 'en' else 'el' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();
