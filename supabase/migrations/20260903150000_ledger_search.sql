-- ═════════════════════════════════════════════════════════════════════════════
-- Ledger search — one bar over name, phone, email and licence number
-- (docs/01-DECISIONS.md §41, building on §25a's customer ledger).
--
-- Two additions, both scoped to the admin-only side of §25a. Neither touches
-- customer_by_phone() or a rep's access, which stays exact-phone-only,
-- rate-limited and logged, exactly as §29 decided.
--
--   1. `customers.email`. The ledger never had one — only phone, name, dob
--      and licence fields. §9 already collects a guest's email on the
--      booking (`bookings.cust_email`, optional, asked at signing), so this
--      is not a new collection, only a copy kept where the ledger's other
--      fields already live, on the same consent (§25a §2) and the same
--      manual-only retention (§25a §1). admin_erase_customer() and
--      admin_clear_customer_ledger() need no changes: they already act on
--      the whole row.
--
--   2. `customers.search_text`. A generated column, the same device
--      `bookings.cust_phone_e164` uses ten migrations up, for the same
--      reason — a value every write produces on its own, rather than one an
--      app remembers to compute. One `pg_trgm` index on it is what the admin
--      ledger search bar now matches against, in place of the three-column
--      `.or(...ilike...)` the old erasure-only lookup ran, and it covers
--      email and licence number too without three more indexes for three
--      more columns.
-- ═════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

alter table public.customers
  add column email text,
  add constraint customers_email_len check (email is null or char_length(email) <= 254);

comment on column public.customers.email is
  'Copied from bookings.cust_email at consent time (record_customer_consent) and kept current when it is captured later (app.customers_refresh_email_from_booking). Optional, like the field it is copied from.';

-- Generated, so every row — including every one already in the table — has a
-- search_text that matches it, and no write path can produce a customer row
-- without one. lower() and coalesce() are built-ins: unlike app.phone_e164(),
-- this needs no EXECUTE grant to exist on a session's insert.
alter table public.customers
  add column search_text text generated always as (
    lower(
      coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
      coalesce(phone_e164, '') || ' ' || coalesce(email, '') || ' ' ||
      coalesce(licence_number, '')
    )
  ) stored;

comment on column public.customers.search_text is
  'Generated: lower-cased name, phone, email and licence number, space-joined. The one column the admin ledger search bar matches against (customers_search_trgm_idx).';

create index customers_search_trgm_idx
  on public.customers using gin (search_text gin_trgm_ops);

-- ── Capturing email at consent time ─────────────────────────────────────────
-- record_customer_consent() now also reads and stores cust_email, on the same
-- coalesce-never-overwrite-with-null terms as every other field it upserts.
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

  select b.id, b.cust_phone_e164, b.cust_first, b.cust_last, b.cust_dob, b.cust_email
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
    phone_e164, first_name, last_name, dob, email,
    licence_number, licence_country, licence_issued_on, licence_expires_on,
    licence_booking_id, licence_front_path, licence_back_path)
  values (
    v_booking.cust_phone_e164,
    coalesce(v_driver.first_name, v_booking.cust_first),
    coalesce(v_driver.last_name,  v_booking.cust_last),
    coalesce(v_driver.dob,        v_booking.cust_dob),
    v_booking.cust_email,
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
    email               = coalesce(excluded.email,              c.email),
    licence_number     = coalesce(excluded.licence_number,    c.licence_number),
    licence_country    = coalesce(excluded.licence_country,   c.licence_country),
    licence_issued_on  = coalesce(excluded.licence_issued_on, c.licence_issued_on),
    licence_expires_on = coalesce(excluded.licence_expires_on, c.licence_expires_on),
    licence_booking_id = coalesce(excluded.licence_booking_id, c.licence_booking_id),
    licence_front_path = coalesce(excluded.licence_front_path, c.licence_front_path),
    licence_back_path  = coalesce(excluded.licence_back_path,  c.licence_back_path),
    last_seen_at       = now(),
    updated_at          = now()
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

-- ── Keeping email current when it arrives later ─────────────────────────────
-- §33 lets a guest give their email at the SEPARATE "email me a copy" step
-- (contract-actions.ts emailContract), which runs after signing — so it can
-- run after record_customer_consent() already inserted the ledger row with no
-- email on it. Same shape as app.customers_refresh_from_driver() (0021): a
-- trigger reacting to a write a rep may already make, not a new RPC. A new
-- client-callable function that writes to `customers` would be a second door
-- into a table that deliberately has exactly one insert path and one update
-- path today; a trigger on the write that already exists needs neither a new
-- grant nor a new door.
create or replace function app.customers_refresh_email_from_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cust_email is null then return new; end if;

  update public.customers c set
    email      = new.cust_email,
    updated_at = now()
  from public.customer_bookings l
  where l.booking_id = new.id and c.id = l.customer_id
    and c.email is distinct from new.cust_email;

  return new;
end;
$$;

create trigger bookings_refresh_customer_email
  after update of cust_email on public.bookings
  for each row execute function app.customers_refresh_email_from_booking();

-- Same defensive re-statement 0025's default privilege already covers, and
-- the same reason every trigger function beside it carries the line: there is
-- no pg_default_acl row for a schema created before the default was written,
-- so a function created after it still arrives with EXECUTE-to-PUBLIC intact
-- unless revoked by name (docs/01-DECISIONS.md §30, "A second finding").
revoke all on function app.customers_refresh_email_from_booking() from public, anon, authenticated;
