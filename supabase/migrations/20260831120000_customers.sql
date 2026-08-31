-- ═════════════════════════════════════════════════════════════════════════════
-- 0021 · Ψηφιακό πελατολόγιο — the customer ledger (docs/01-DECISIONS.md §25a)
--
-- Until now this app had NO cross-booking customer identity. Everything was
-- booking-scoped: a guest who rented last August and rents again this August
-- was two unrelated rows that happened to share a phone number. This migration
-- introduces the missing entity, and with it the two things the business asked
-- for — a returning guest's details filling themselves in, and a ledger the
-- boss actually owns.
--
-- THREE DECISIONS ARE BAKED IN HERE AND ALL THREE WERE THE OWNER'S TO MAKE.
-- They are recorded in docs/01-DECISIONS.md §25a; repeated here because the
-- code is where they will be read:
--
--   1. RETENTION IS MANUAL. There is deliberately NO automatic window and no
--      purge job on this table — unlike the licence images next door, which
--      expire on app.licence_retention_cutoff(). A customer stays in the
--      ledger until the boss clears it. That is a weaker position than a
--      timed window and it was chosen knowingly (see §25a for the argument
--      and the advice given against it), so the compensating controls are
--      that the clearing is REAL and reachable
--      (admin_clear_customer_ledger), that a single person can be erased on
--      request (admin_erase_customer), and that the privacy policy says
--      plainly that the store is indefinite rather than implying a window
--      that does not exist.
--
--   2. THE LEDGER IS CONSENT-GATED. Nothing lands in `customers` because a
--      booking was made. A row appears only when the guest ticks a box NEXT TO
--      the signature — separate from signing the agreement, never bundled into
--      it — and `customer_bookings.consent_at` is the evidence that they did.
--      That separation is the whole legal basis: consent buried in a contract
--      the guest has to sign anyway is not freely given (GDPR Art. 7(4)), so
--      it is its own tick box with its own wording. Un-ticking later is
--      withdraw_customer_consent(), which really deletes.
--
--   3. THE LOOKUP IS COMPANY-WIDE, AND IT IS THEREFORE NOT A TABLE READ.
--      docs/01-DECISIONS.md §29 asked whether reps search all past customers
--      or only their own; the answer is ALL, which is a genuine widening of
--      §8's cross-rep rule and is treated as one. A rep gets NO select on this
--      table. They get one function, customer_by_phone(), which takes a
--      complete phone number, returns at most one row, never returns a phone
--      number, cannot be used to browse or to list, is rate limited in
--      Postgres rather than in the app, and writes a security event every
--      time it is called. An admin, who could already see every booking, gets
--      the table.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Phone normalisation, in ONE place ───────────────────────────────────────
-- `cust_phone` has always been free text (min 4, max 32, no shape at all), and
-- matching a returning guest on free text does not work: "+30 694 123 4567",
-- "6941234567" and "0030 6941234567" are the same person and three different
-- strings. So there is a canonical form, and it is computed HERE — not in
-- TypeScript — because a normaliser that lives in the app runs only on the
-- paths that remember to call it, and this one has to run on every write:
-- the rep's booking form, the admin's edit screen, the seed, a psql session.
--
-- IMMUTABLE, because `bookings.cust_phone_e164` below is a generated column
-- and Postgres will not accept anything else. That is a feature: a generated
-- column cannot be sent by a client at all, so there is no grant to get wrong
-- and no trigger ordering to reason about. The stored key is a FUNCTION of the
-- typed number, always, with no way to set one without the other.
--
-- WHAT IT REFUSES IS THE INTERESTING HALF. A bare "07911123456" could be a UK
-- mobile with a trunk zero or half a dozen other countries' numbers, and
-- guessing wrong does not produce a failed match — it produces a match against
-- SOMEONE ELSE, and this ledger fills a rental agreement in with whatever it
-- matched. So an ambiguous number normalises to NULL, and a null key is never
-- ledgered and never looked up. Refusing to guess is the safe failure here;
-- the rep types the details in by hand exactly as they did before.
create or replace function app.phone_e164(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text;
  v_plus   boolean;
begin
  if p_raw is null then return null; end if;

  v_plus   := left(btrim(p_raw), 1) = '+';
  v_digits := regexp_replace(p_raw, '[^0-9]', '', 'g');

  -- '00' is the international prefix written out; it means exactly '+'.
  if not v_plus and left(v_digits, 2) = '00' then
    v_plus   := true;
    v_digits := substr(v_digits, 3);
  end if;

  if v_digits = '' then return null; end if;

  -- The caller said which country. Believe them, within E.164's own bounds.
  if v_plus then
    if length(v_digits) between 8 and 15 and left(v_digits, 1) <> '0' then
      return '+' || v_digits;
    end if;
    return null;
  end if;

  -- Nobody said which country. Strip a national trunk prefix and see whether
  -- what is left is unambiguous.
  v_digits := regexp_replace(v_digits, '^0+', '');

  -- Greece: ten digits, landlines start 2, mobiles start 6. This is the desk's
  -- own country and by far the commonest thing typed without a country code.
  if length(v_digits) = 10 and left(v_digits, 1) in ('2', '6') then
    return '+30' || v_digits;
  end if;

  -- A full international number with the '+' left off — "306941234567",
  -- "447911123456". Eleven digits or more cannot be a bare national number in
  -- any plan we serve, so reading it as international is safe.
  if length(v_digits) between 11 and 15 then
    return '+' || v_digits;
  end if;

  -- Anything else is ambiguous. Say so by saying nothing.
  return null;
end;
$$;

comment on function app.phone_e164(text) is
  'The canonical E.164 form of a typed phone number, or NULL when the number is ambiguous without a country code. The single normaliser: bookings.cust_phone_e164 is generated from it and customer_by_phone() matches on it.';

-- GRANTED TO `authenticated`, AND IT HAS TO BE. The obvious reading is that a
-- generated column is the system's business — the session never calls this
-- function, it only inserts a row — so the grant could be withheld and `app`
-- would keep exposing nothing but the handful of functions 0001 names on
-- purpose. That reading is wrong: Postgres checks EXECUTE on a generated
-- column's expression against the role performing the write, so without this
-- line every rep's booking insert fails with "permission denied for function
-- phone_e164". Tried, measured, reverted.
--
-- The exposure is nil. It is IMMUTABLE, takes a string, returns a string,
-- reads nothing and writes nothing; calling it tells you only how this system
-- would normalise a number you already typed. tests/db/privileges.test.ts
-- names it in the allowed list for that reason.
grant execute on function app.phone_e164(text) to authenticated, service_role;

-- ── The key on the booking ──────────────────────────────────────────────────
-- Generated and stored, so it exists for every row already in the table and
-- for every row written from now on, by any route, and cannot be tampered
-- with: Postgres refuses an INSERT or UPDATE that names a generated column, so
-- there is nothing here for a hostile client to send.
--
-- It is granted to `authenticated` alongside cust_phone, which it is derived
-- from — withholding it would gain nothing (a rep who can read the number can
-- normalise it themselves) and would break `select *`.
alter table public.bookings
  add column cust_phone_e164 text
    generated always as (app.phone_e164(cust_phone)) stored;

grant select (cust_phone_e164) on public.bookings to authenticated;

create index bookings_cust_phone_e164_idx on public.bookings (cust_phone_e164)
  where cust_phone_e164 is not null;

comment on column public.bookings.cust_phone_e164 is
  'Canonical form of cust_phone, generated. NULL when the typed number was ambiguous — such a booking can never be matched to a ledger customer, by design.';

-- ── The ledger ──────────────────────────────────────────────────────────────
-- One row per person, keyed on the phone number, holding the details that make
-- a second rental faster to write down. Deliberately NOT holding: booking
-- history, prices, hotels, rooms, which rep served them, or anything a rep
-- could use to see round §8. It is a form-filling aid and its columns are
-- exactly the fields of the form it fills.
--
-- `licence_*_path` points at objects in ANOTHER booking's folder. Nothing is
-- ever read through those pointers by a rep's session — see
-- src/lib/customers/licence-reuse.ts, which COPIES the object into the new
-- booking's own folder rather than widening read access to the old one, so
-- each copy carries its own §25 retention clock.
create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  phone_e164          text not null unique,
  first_name          text,
  last_name           text,
  dob                 date,
  licence_number      text,
  licence_country     text,
  licence_issued_on   date,
  licence_expires_on  date,
  -- Where the most recent licence photos live, so they can be COPIED forward.
  licence_booking_id  uuid references public.bookings on delete set null,
  licence_front_path  text,
  licence_back_path   text,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint customers_phone_shape check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint customers_name_len check (
    (first_name is null or char_length(first_name) between 1 and 80) and
    (last_name  is null or char_length(last_name)  between 1 and 80)),
  constraint customers_licence_len check (
    licence_number is null or char_length(licence_number) <= 40),
  constraint customers_country_len check (
    licence_country is null or char_length(licence_country) between 2 and 3)
);

create index on public.customers (last_seen_at desc);
create index on public.customers (last_name, first_name);

comment on table public.customers is
  'Ψηφιακό πελατολόγιο. One row per consenting guest, keyed on their phone number. NO automatic retention — cleared only by admin_clear_customer_ledger() or admin_erase_customer() (docs/01-DECISIONS.md §25a).';

-- ── The consent, and the link ───────────────────────────────────────────────
-- This table is the evidence. A customer row exists because at least one of
-- these rows exists, and each of these rows exists because a guest ticked a
-- box beside their signature on that booking at that moment. Delete the last
-- link and the customer goes with it (the trigger below), which is what makes
-- "I withdraw" mean something.
create table public.customer_bookings (
  booking_id   uuid primary key references public.bookings on delete cascade,
  customer_id  uuid not null references public.customers on delete cascade,
  consent_at   timestamptz not null default now(),
  consent_by   uuid references public.profiles on delete set null,
  created_at   timestamptz not null default now()
);

create index on public.customer_bookings (customer_id);

comment on table public.customer_bookings is
  'One row per booking whose guest consented to being kept in the ledger. consent_at is the evidence that the tick box beside the signature was ticked.';

-- A customer with no consenting booking left has no basis to exist, so it does
-- not. This runs on the delete of the LAST link, whether that delete came from
-- a withdrawal, a booking being deleted, or an erasure.
create or replace function app.customers_drop_orphan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.customers c
   where c.id = old.customer_id
     and not exists (select 1 from public.customer_bookings l
                      where l.customer_id = old.customer_id);
  return old;
end;
$$;

create trigger customer_bookings_drop_orphan
  after delete on public.customer_bookings
  for each row execute function app.customers_drop_orphan();

-- ── Recording consent ───────────────────────────────────────────────────────
-- Called by the signing step when, and only when, the separate tick box was
-- ticked. Everything it writes it reads from rows the CALLER can already see,
-- so this is not a way to ledger somebody else's guest.
--
-- Returns the customer id, or NULL when the booking's phone number could not
-- be normalised — which is not an error. The rental proceeds; there is simply
-- nothing to key a ledger entry on, and the screen says so.
create or replace function public.record_customer_consent(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking  record;
  v_driver   record;
  v_customer uuid;
begin
  perform app.assert_staff();

  if not app.can_read_booking(p_booking_id) then
    raise exception using errcode = 'IR001', message = 'not authorised';
  end if;

  select b.id, b.cust_phone_e164, b.cust_first, b.cust_last, b.cust_dob
    into v_booking
    from public.bookings b
   where b.id = p_booking_id and b.kind = 'rental';

  if not found or v_booking.cust_phone_e164 is null then
    return null;
  end if;

  -- The main driver is the person the ledger is about. Additional drivers are
  -- free and captured identically (§9) but no phone is captured for them, so
  -- there is nothing to key them on and they are deliberately not ledgered.
  select d.first_name, d.last_name, d.dob,
         d.licence_number, d.licence_country, d.licence_issued_on, d.licence_expires_on,
         d.front_image_path, d.back_image_path, d.images_purged_at
    into v_driver
    from public.booking_drivers d
   where d.booking_id = p_booking_id and d.is_main
   limit 1;

  insert into public.customers as c (
    phone_e164, first_name, last_name, dob,
    licence_number, licence_country, licence_issued_on, licence_expires_on,
    licence_booking_id, licence_front_path, licence_back_path)
  values (
    v_booking.cust_phone_e164,
    coalesce(v_driver.first_name, v_booking.cust_first),
    coalesce(v_driver.last_name,  v_booking.cust_last),
    coalesce(v_driver.dob,        v_booking.cust_dob),
    v_driver.licence_number, v_driver.licence_country,
    v_driver.licence_issued_on, v_driver.licence_expires_on,
    case when v_driver.images_purged_at is null and v_driver.front_image_path is not null
         then p_booking_id end,
    case when v_driver.images_purged_at is null then v_driver.front_image_path end,
    case when v_driver.images_purged_at is null then v_driver.back_image_path  end)
  on conflict (phone_e164) do update set
    -- The most recent rental is the most current truth about a person, so a
    -- returning guest's details are refreshed rather than left as they were
    -- three years ago. Never overwritten with a null: a re-scan that failed to
    -- read the expiry date must not erase the expiry date we already had.
    first_name         = coalesce(excluded.first_name,        c.first_name),
    last_name          = coalesce(excluded.last_name,         c.last_name),
    dob                = coalesce(excluded.dob,               c.dob),
    licence_number     = coalesce(excluded.licence_number,    c.licence_number),
    licence_country    = coalesce(excluded.licence_country,   c.licence_country),
    licence_issued_on  = coalesce(excluded.licence_issued_on, c.licence_issued_on),
    licence_expires_on = coalesce(excluded.licence_expires_on, c.licence_expires_on),
    licence_booking_id = coalesce(excluded.licence_booking_id, c.licence_booking_id),
    licence_front_path = coalesce(excluded.licence_front_path, c.licence_front_path),
    licence_back_path  = coalesce(excluded.licence_back_path,  c.licence_back_path),
    last_seen_at       = now(),
    updated_at         = now()
  returning c.id into v_customer;

  insert into public.customer_bookings (booking_id, customer_id, consent_by)
  values (p_booking_id, v_customer, auth.uid())
  on conflict (booking_id) do update set
    customer_id = excluded.customer_id,
    consent_at  = now(),
    consent_by  = excluded.consent_by;

  perform app.log_security_event('customer_consent', auth.uid(), null, null,
    jsonb_build_object('booking_id', p_booking_id));

  return v_customer;
end;
$$;

comment on function public.record_customer_consent(uuid) is
  'Ledger this booking''s guest, because they ticked the consent box beside their signature. NULL when the phone number could not be normalised. Never called except from that tick box.';

-- ── Withdrawing it ──────────────────────────────────────────────────────────
-- The other half of a consent-based store: un-ticking has to mean something.
-- Removing the link removes the evidence, and the orphan trigger removes the
-- customer when it was their only rental. Reachable by the rep at the desk,
-- because that is where a guest changes their mind.
create or replace function public.withdraw_customer_consent(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  perform app.assert_staff();

  if not app.can_read_booking(p_booking_id) then
    raise exception using errcode = 'IR001', message = 'not authorised';
  end if;

  delete from public.customer_bookings where booking_id = p_booking_id;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    perform app.log_security_event('customer_consent_withdrawn', auth.uid(), null, null,
      jsonb_build_object('booking_id', p_booking_id));
  end if;

  return v_rows > 0;
end;
$$;

-- Keeping the ledger current when a rep corrects a licence AFTER signing.
-- Only ever touches a customer this booking is already linked to: it cannot
-- create a link, so it can never ledger a guest who did not consent.
create or replace function app.customers_refresh_from_driver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.is_main then return new; end if;

  update public.customers c set
    first_name         = coalesce(new.first_name,        c.first_name),
    last_name          = coalesce(new.last_name,         c.last_name),
    dob                = coalesce(new.dob,               c.dob),
    licence_number     = coalesce(new.licence_number,    c.licence_number),
    licence_country    = coalesce(new.licence_country,   c.licence_country),
    licence_issued_on  = coalesce(new.licence_issued_on, c.licence_issued_on),
    licence_expires_on = coalesce(new.licence_expires_on, c.licence_expires_on),
    licence_booking_id = case when new.images_purged_at is null and new.front_image_path is not null
                              then new.booking_id else c.licence_booking_id end,
    licence_front_path = case when new.images_purged_at is null and new.front_image_path is not null
                              then new.front_image_path else c.licence_front_path end,
    licence_back_path  = case when new.images_purged_at is null and new.back_image_path is not null
                              then new.back_image_path else c.licence_back_path end,
    updated_at         = now()
  from public.customer_bookings l
  where l.booking_id = new.booking_id and c.id = l.customer_id;

  return new;
end;
$$;

create trigger booking_drivers_refresh_customer
  after insert or update on public.booking_drivers
  for each row execute function app.customers_refresh_from_driver();

-- A purge that deletes a licence image must not leave the ledger pointing at
-- it, or the reuse path would try to copy a file that is gone.
create or replace function app.customers_forget_purged_images()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.images_purged_at is not null and old.images_purged_at is null then
    update public.customers c
       set licence_booking_id = null,
           licence_front_path = null,
           licence_back_path  = null,
           updated_at         = now()
     where c.licence_booking_id = new.booking_id;
  end if;
  return new;
end;
$$;

create trigger booking_drivers_forget_purged_images
  after update on public.booking_drivers
  for each row execute function app.customers_forget_purged_images();

-- ── The lookup ──────════════════════════════════════════════════════════════
-- The whole of a rep's access to this table, and the reason there is no policy
-- granting them one. What makes a company-wide lookup tolerable is not that
-- reps are trusted with the ledger — it is that this function is the only door
-- and the door is narrow:
--
--   · IT MATCHES ON A COMPLETE, EXACT NUMBER. No prefix, no LIKE, no fuzzy
--     name search, no "did you mean". A rep who does not already know the
--     number learns nothing.
--   · IT RETURNS AT MOST ONE ROW, and never the phone number, never any
--     booking, hotel, room, price or rep. Nothing that §8 protects.
--   · IT IS RATE LIMITED IN POSTGRES. 40 lookups an hour is far more than a
--     desk needs and far too few to walk a number range. The limit is here
--     rather than in the app because the app is not the only thing that can
--     call a PostgREST function with a rep's token.
--   · EVERY CALL IS LOGGED, hit or miss, with the caller — never the number
--     they tried. A ledger that can be queried company-wide needs a record of
--     who queried it.
create or replace function public.customer_by_phone(p_phone text)
returns table (
  customer_id        uuid,
  first_name         text,
  last_name          text,
  dob                date,
  licence_number     text,
  licence_country    text,
  licence_issued_on  date,
  licence_expires_on date,
  has_licence_images boolean,
  last_seen_at       timestamptz
)
language plpgsql
-- NOT `stable`: this function writes. It bumps the rate-limit bucket and it
-- records a security event, and Postgres forbids both inside a STABLE
-- function. The limiter and the log are the two things that make a
-- company-wide lookup defensible, so the volatility follows them.
security definer
set search_path = ''
as $$
declare
  v_key  text;
  v_rows integer := 0;
begin
  perform app.assert_staff();

  if not app.rate_limit_hit('custlookup:' || coalesce(auth.uid()::text, 'anon'),
                            120, interval '1 hour') then
    raise exception using errcode = 'IR122', message = 'too many customer lookups';
  end if;

  v_key := app.phone_e164(p_phone);
  if v_key is null then
    return;
  end if;

  return query
  select c.id, c.first_name, c.last_name, c.dob,
         c.licence_number, c.licence_country, c.licence_issued_on, c.licence_expires_on,
         (c.licence_front_path is not null),
         c.last_seen_at
    from public.customers c
   where c.phone_e164 = v_key;

  get diagnostics v_rows = row_count;

  perform app.log_security_event('customer_lookup', auth.uid(), null, null,
    jsonb_build_object('found', v_rows > 0));
end;
$$;

comment on function public.customer_by_phone(text) is
  'The ONLY way a rep reaches the ledger (docs/01-DECISIONS.md §25a). Exact full-number match, at most one row, never the phone back, rate limited, logged. Reps have no select on public.customers.';

-- Where the licence photos of a matched customer actually live. Split out
-- because it is a strictly larger disclosure than the form fields — it names
-- another booking — and so it is asked for separately, only when the rep has
-- chosen to reuse the images, and logged as its own event.
create or replace function public.customer_licence_images(p_customer_id uuid)
returns table (source_booking_id uuid, front_path text, back_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_staff();

  return query
  select c.licence_booking_id, c.licence_front_path, c.licence_back_path
    from public.customers c
   where c.id = p_customer_id
     and c.licence_booking_id is not null
     and c.licence_front_path is not null;
end;
$$;

-- ── What the boss can do with it ────────────────────────────────────────────
create or replace function public.admin_customer_ledger_status()
returns table (
  total              bigint,
  with_licence_images bigint,
  linked_bookings    bigint,
  oldest_seen        timestamptz,
  newest_seen        timestamptz,
  last_cleared_at    timestamptz,
  last_erasure_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_admin();

  return query
  select
    (select count(*) from public.customers),
    (select count(*) from public.customers where licence_front_path is not null),
    (select count(*) from public.customer_bookings),
    (select min(first_seen_at) from public.customers),
    (select max(last_seen_at)  from public.customers),
    (select max(e.at) from app.auth_events e where e.kind = 'customer_ledger_cleared'),
    (select max(e.at) from app.auth_events e where e.kind = 'customer_erased');
end;
$$;

-- Right to erasure, one person. Returns the licence objects that were pointed
-- at, because a "forget me" that leaves the guest's licence photographs in the
-- bucket is not an erasure — src/lib/customers/erase.ts deletes them through
-- the Storage API, for the same reason the §25 purge does.
create or replace function public.admin_erase_customer(p_customer_id uuid)
returns table (front_path text, back_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare v_front text; v_back text;
begin
  perform app.assert_admin();

  select c.licence_front_path, c.licence_back_path into v_front, v_back
    from public.customers c where c.id = p_customer_id;

  if not found then
    return;
  end if;

  delete from public.customers where id = p_customer_id;

  perform app.log_security_event('customer_erased', auth.uid(), null, null,
    jsonb_build_object('had_images', v_front is not null));

  return query select v_front, v_back;
end;
$$;

-- Clearing the whole thing. This is the ONLY retention mechanism this table
-- has, by the owner's decision, so it must actually work and must be very hard
-- to press by accident: a literal confirmation phrase, plus two independent
-- acknowledgements the screen makes the boss give separately. All three are
-- re-checked here, because a check that only exists in a form is not a check.
create or replace function public.admin_clear_customer_ledger(
  p_confirm text,
  p_understood boolean,
  p_irreversible boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  perform app.assert_admin();

  if p_confirm is distinct from 'ERASE-ALL'
     or p_understood is not true
     or p_irreversible is not true then
    raise exception using errcode = 'IR104', message = 'clear not confirmed';
  end if;

  delete from public.customers;
  get diagnostics v_rows = row_count;

  perform app.log_security_event('customer_ledger_cleared', auth.uid(), null, null,
    jsonb_build_object('customers', v_rows));

  return v_rows;
end;
$$;

-- ── RLS and grants ──────════════════════════════════════════════════════════
-- The shape of the decision, in privileges:
--
--   customers          — admin reads it, nobody writes it directly. A rep has
--                        no policy at all, so a rep selecting from it gets
--                        zero rows no matter what they send.
--   customer_bookings  — the same, plus the rep can see whether the booking in
--                        front of them is linked, so the tick box can render
--                        in the state the guest left it.
--
-- Every write goes through the security-definer functions above, which is
-- where the consent rule and the "only bookings you can read" rule live.
alter table public.customers        enable row level security;
alter table public.customer_bookings enable row level security;

grant select on public.customers to authenticated;
create policy customers_admin_select on public.customers
  for select to authenticated using (app.is_admin());

grant select on public.customer_bookings to authenticated;
create policy customer_bookings_select on public.customer_bookings
  for select to authenticated
  using (app.is_admin() or app.can_read_booking(booking_id));

-- The trigger functions are the schema's own business: nothing calls them by
-- name, so nothing may. Supabase's default privileges on `public` hand EXECUTE
-- to anon and authenticated on every newly created function, which is the
-- reason this has to be said rather than assumed (tests/helpers/supabase-shim.sql
-- reproduces those defaults so the harness cannot be more restrictive than
-- production).
do $$
declare fn text;
begin
  foreach fn in array array[
    'app.customers_drop_orphan()',
    'app.customers_refresh_from_driver()',
    'app.customers_forget_purged_images()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.record_customer_consent(uuid)',
    'public.withdraw_customer_consent(uuid)',
    'public.customer_by_phone(text)',
    'public.customer_licence_images(uuid)',
    'public.admin_customer_ledger_status()',
    'public.admin_erase_customer(uuid)',
    'public.admin_clear_customer_ledger(text,boolean,boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;

-- ── Why `customers` is NOT audited ──────────────────────────────────────────
-- Every other table of consequence has an app.audit() trigger on it
-- (supabase/migrations/20260830091000_guards.sql), and the obvious thing to do
-- here would be to add one more. It is deliberately absent, and the reason is
-- the erasure path.
--
-- app.audit() writes `before` and `after` as whole rows into public.audit_log.
-- app.audit_redact() strips pin_hash, licence_number and the two image paths —
-- but not a name, not a date of birth, not a phone number. So auditing this
-- table would mean that admin_erase_customer() deletes the guest's record and
-- then, in the same statement, writes their name, date of birth and phone
-- number into a second table that has no erasure path at all. That is a
-- right-to-erasure obligation marked done while the data is still there, which
-- is the same failure the §25 purge was written to avoid.
--
-- The changes ARE recorded, without the personal data: customer_consent,
-- customer_consent_withdrawn, customer_erased and customer_ledger_cleared all
-- go to app.auth_events with counts and booking ids and nothing else. The link
-- table below holds no personal data of its own, so it is audited normally.
create trigger audit_customer_bookings after insert or update or delete on public.customer_bookings
  for each row execute function app.audit();
