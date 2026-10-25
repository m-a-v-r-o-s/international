-- ═════════════════════════════════════════════════════════════════════════════
-- One gratis code per login (docs/01-DECISIONS.md §48)
--
-- 20261025130000 kept one code for the whole app. The owner wants each manager
-- login to have its own: the developer's code stays his, and the boss chooses
-- his own the first time he unlocks. Whoever uses the boss's login (his
-- father) then needs the boss's code.
--
-- The single code set before this is dropped rather than guessed onto an
-- account; its owner chooses again on the next unlock.
-- ═════════════════════════════════════════════════════════════════════════════

drop table public.gratis_lock;

create table public.gratis_lock (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  code_hash  text not null,
  updated_at timestamptz not null default now()
);

alter table public.gratis_lock enable row level security;
revoke all on public.gratis_lock from public, anon, authenticated;
grant select, insert, update on public.gratis_lock to service_role;
