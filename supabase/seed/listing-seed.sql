-- ═════════════════════════════════════════════════════════════════════════════
-- LISTING SEED. STORE ASSETS ONLY. NOT A TEST FIXTURE, NOT THE CLIENT'S DATA.
--
-- This exists for one job: making the screens in docs/08-PLAY-STORE.md §A6 look
-- like a working August morning so they can be photographed for the Play Store
-- listing. It is not part of the test fixtures (tests/helpers/fixtures.ts owns
-- those) and it is not the development seed (supabase/seed/dev-seed.sql, which
-- names every category "PLACEHOLDER", correct for an engine test and unusable in
-- a public image).
--
-- DO NOT RUN THIS AGAINST PRODUCTION. It DELETES the fleet, the hotels, the
-- pricing and every booking before it writes its own. It refuses to run if it
-- finds a signed contract, on the grounds that a database with real rentals in
-- it is not a scratch database.
--
-- Two standing rules apply at once and neither bends:
--
--   · NO CLIENT DATA, EVER, IN A PUBLIC IMAGE. The real fleet, hotels and
--     prices are still outstanding (HANDOFF.md "Blocked on the client", items
--     1 to 6) and must not appear here even after they arrive.
--   · INVENTED, BUT LOCALLY PLAUSIBLE. Cretan plate prefixes (ΗΡ Heraklion,
--     ΧΝ Chania, ΡΕ Rethymno, ΑΝ Lasithi), hotel names of the kind this market
--     actually has, category names a Greek rent-a-car would actually print, and
--     prices in a believable August band. Every one of them is made up.
--
-- Everything is anchored to current_date, so the movements sheet has a today
-- whenever the screenshots get retaken, and the pricing periods cover the whole
-- year so a quote resolves in February as well as in August.
--
-- Run it as the owner or the service role, in one statement:
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed/listing-seed.sql
--
-- It needs one admin profile to already exist: bookings are stamped with a
-- creator and the booking guard prices and stamps them as that admin.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_admin   uuid;
  v_year    smallint := extract(year from current_date)::smallint;
  v_low     uuid;
  v_mid     uuid;
  v_peak    uuid;
  v_late    uuid;
  v_depot   uuid;
begin
  -- ── Refuse to touch anything that looks real ──────────────────────────────
  if exists (select 1 from public.contracts) then
    raise exception
      'listing-seed refuses to run: this database has signed contracts in it, '
      'so it is not a scratch database. Point DATABASE_URL somewhere else.';
  end if;

  select p.id into v_admin
  from public.profiles p
  where p.role = 'admin' and p.active
  order by p.created_at
  limit 1;

  if v_admin is null then
    raise exception
      'listing-seed needs an admin profile to exist: every booking is stamped '
      'with a creator, and the booking guard prices as an admin or not at all.';
  end if;

  -- The booking guard (app.bookings_before_write) drops kind, status, price and
  -- created_by on the floor for anybody who is not an admin, which would turn
  -- every row below into an identical un-priced 'booked'. Becoming the admin for
  -- the length of this block is what lets a seed write an 'out' rental at all.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  -- ── Clear what this file is about to replace ──────────────────────────────
  delete from public.incidents;
  delete from public.car_relocations;
  delete from public.bookings;          -- cascades drivers, extras, handovers, damage
  delete from public.cash_handovers;
  delete from public.customers;
  delete from public.cars;
  delete from public.car_models;
  delete from public.price_extra_day;
  delete from public.price_rows;
  delete from public.pricing_periods;
  delete from public.categories;
  delete from public.hotel_reps;
  delete from public.hotels;

  -- ── Categories ────────────────────────────────────────────────────────────
  -- Five, not the client's eight. Ages follow docs/01-DECISIONS.md §11: 21 on
  -- the two smallest, 23 above them. Those ARE decided; the names are not.
  insert into public.categories
    (code, name_el, name_en, min_driver_age, min_licence_years, sort_order)
  values
    ('A', 'Μίνι',                'Mini',              21, 1, 1),
    ('B', 'Οικονομικό',          'Economy',           21, 1, 2),
    ('C', 'Οικονομικό αυτόματο', 'Economy automatic', 23, 1, 3),
    ('D', 'SUV',                 'SUV',               23, 1, 4),
    ('E', 'Επταθέσιο',           'Seven-seater',      23, 1, 5);

  -- ── Models ────────────────────────────────────────────────────────────────
  insert into public.car_models
    (make, model, category_id, transmission, fuel_type, seats, doors, tank_litres)
  select m.make, m.model, c.id, m.transmission, m.fuel_type, m.seats, m.doors, m.tank
  from public.categories c
  join (values
    ('A', 'Fiat',    'Panda',           'manual',    'petrol', 4, 5, 37.0),
    ('A', 'Hyundai', 'i10',             'manual',    'petrol', 4, 5, 36.0),
    ('B', 'Toyota',  'Yaris',           'manual',    'petrol', 5, 5, 42.0),
    ('B', 'Opel',    'Corsa',           'manual',    'petrol', 5, 5, 44.0),
    ('C', 'Citroen', 'C3 Automatic',    'automatic', 'petrol', 5, 5, 44.0),
    ('C', 'Nissan',  'Micra Automatic', 'automatic', 'petrol', 5, 5, 41.0),
    ('D', 'Suzuki',  'Vitara',          'manual',    'petrol', 5, 5, 47.0),
    ('D', 'Nissan',  'Qashqai',         'automatic', 'diesel', 5, 5, 55.0),
    ('E', 'Toyota',  'Proace Verso',    'manual',    'diesel', 8, 5, 70.0),
    ('E', 'Ford',    'Tourneo Connect', 'manual',    'diesel', 7, 5, 54.0)
  ) as m(code, make, model, transmission, fuel_type, seats, doors, tank)
    on m.code = c.code;

  -- ── Hotels ────────────────────────────────────────────────────────────────
  -- Invented. Four hotels across the four prefectures the plates below come
  -- from, plus the yard, which docs/01-DECISIONS.md §45 wants sorted first in
  -- any destination list.
  insert into public.hotels (name, area, is_depot) values
    ('Kritamos Beach Hotel',  'Ρέθυμνο',        false),
    ('Ammos Bay Suites',      'Χανιά',          false),
    ('Nostos Village Resort', 'Ηράκλειο',       false),
    ('Elia Sunrise Hotel',    'Άγιος Νικόλαος', false),
    ('Γραφείο Ρεθύμνου',      'Ρέθυμνο',        true);

  select id into v_depot from public.hotels where is_depot;

  -- Every active rep covers every hotel here. That is not how a season is
  -- actually staffed. It is so that whichever rep account the screenshots are
  -- taken from can see the bookings below, rather than one lucky one.
  insert into public.hotel_reps (hotel_id, profile_id, is_primary)
  select h.id, p.id, h.is_depot = false and h.name = 'Kritamos Beach Hotel'
  from public.hotels h
  cross join public.profiles p
  where p.role = 'rep' and p.active;

  -- ── Cars ──────────────────────────────────────────────────────────────────
  -- 20 plates in the Greek three-letter/four-digit shape, prefixed by
  -- prefecture: ΗΡ Ηράκλειο, ΧΝ Χανιά, ΡΕ Ρέθυμνο, ΑΝ Λασίθι.
  insert into public.cars (plate, model_id, year, colour, stationed_at)
  select v.plate, cm.id, v.year, v.colour, v_depot
  from public.car_models cm
  join (values
    ('ΡΕΚ 4821', 'Fiat',    'Panda',           2023, 'white'),
    ('ΡΕΚ 4822', 'Fiat',    'Panda',           2022, 'silver'),
    ('ΗΡΤ 1094', 'Hyundai', 'i10',             2023, 'white'),
    ('ΗΡΤ 1095', 'Hyundai', 'i10',             2024, 'grey'),
    ('ΡΕΒ 7310', 'Toyota',  'Yaris',           2023, 'white'),
    ('ΡΕΒ 7311', 'Toyota',  'Yaris',           2024, 'blue'),
    ('ΧΝΑ 2046', 'Toyota',  'Yaris',           2022, 'silver'),
    ('ΧΝΑ 2047', 'Opel',    'Corsa',           2023, 'white'),
    ('ΗΡΚ 5528', 'Opel',    'Corsa',           2024, 'red'),
    ('ΗΡΚ 5529', 'Opel',    'Corsa',           2022, 'grey'),
    ('ΡΕΗ 8802', 'Citroen', 'C3 Automatic',    2024, 'white'),
    ('ΡΕΗ 8803', 'Citroen', 'C3 Automatic',    2023, 'blue'),
    ('ΑΝΖ 3167', 'Nissan',  'Micra Automatic', 2023, 'white'),
    ('ΑΝΖ 3168', 'Nissan',  'Micra Automatic', 2024, 'silver'),
    ('ΧΝΕ 6473', 'Suzuki',  'Vitara',          2023, 'grey'),
    ('ΧΝΕ 6474', 'Suzuki',  'Vitara',          2024, 'white'),
    ('ΗΡΤ 9015', 'Nissan',  'Qashqai',         2024, 'black'),
    ('ΑΝΚ 2288', 'Nissan',  'Qashqai',         2023, 'white'),
    ('ΡΕΚ 6640', 'Toyota',  'Proace Verso',    2023, 'white'),
    ('ΗΡΚ 7719', 'Ford',    'Tourneo Connect', 2024, 'silver')
  ) as v(plate, make, model, year, colour)
    on v.make = cm.make and v.model = cm.model;

  -- ── Pricing ───────────────────────────────────────────────────────────────
  -- Four bands over the whole calendar year rather than a May-to-October
  -- season, so that a quote resolves whenever these screenshots are retaken.
  insert into public.pricing_periods (season_year, name, start_date, end_date) values
    (v_year, 'Χαμηλή περίοδος', make_date(v_year,  1,  1), make_date(v_year,  5, 31)),
    (v_year, 'Μεσαία περίοδος', make_date(v_year,  6,  1), make_date(v_year,  7, 15)),
    (v_year, 'Υψηλή περίοδος',  make_date(v_year,  7, 16), make_date(v_year,  9, 10)),
    (v_year, 'Τέλος σεζόν',     make_date(v_year,  9, 11), make_date(v_year, 12, 31));

  select id into v_low  from public.pricing_periods where name = 'Χαμηλή περίοδος';
  select id into v_mid  from public.pricing_periods where name = 'Μεσαία περίοδος';
  select id into v_peak from public.pricing_periods where name = 'Υψηλή περίοδος';
  select id into v_late from public.pricing_periods where name = 'Τέλος σεζόν';

  -- Whole euros, totals for 1–7 days. The August day rate per category is the
  -- base; the other bands scale off it, and a longer rental eases off per day,
  -- which is what a real table does. All invented.
  insert into public.price_rows (period_id, category_id, days, total)
  select p.id, c.id, d.days,
         round(
           (case c.code when 'A' then 40 when 'B' then 48 when 'C' then 58
                        when 'D' then 75 else 95 end)
           * (case p.name when 'Χαμηλή περίοδος' then 0.55
                          when 'Μεσαία περίοδος' then 0.78
                          when 'Υψηλή περίοδος'  then 1.00
                          else 0.62 end)
           * d.days
           * (1 - 0.035 * (d.days - 1))
         )::integer
  from public.pricing_periods p
  cross join public.categories c
  cross join generate_series(1, 7) as d(days)
  where p.season_year = v_year;

  insert into public.price_extra_day (period_id, category_id, price)
  select pr.period_id, pr.category_id, round(pr.total / 7.0 * 0.85)::integer
  from public.price_rows pr
  where pr.days = 7;

  -- ── Bookings ──────────────────────────────────────────────────────────────
  -- Twelve rentals over a fortnight around today plus one service block: some
  -- already out, some going out this morning, some coming back, some still
  -- ahead. Guests are invented, and no two overlapping rentals share a car,
  -- the exclusion constraint would refuse them, and rightly.
  --
  -- `total` is left null on purpose: the guard prices every row through
  -- public.quote(), so the numbers on screen are the engine's own and cannot
  -- drift from the table above.
  insert into public.bookings
    (car_id, hotel_id, room_number, status, start_date, end_date,
     pickup_at, dropoff_at,
     cust_first, cust_last, cust_phone, cust_dob, created_by)
  select
    c.id, h.id, v.room, v.status::public.booking_status,
    current_date + v.starts, current_date + v.ends,
    (current_date + v.starts + time '09:30') at time zone 'Europe/Athens',
    (current_date + v.ends   + time '19:00') at time zone 'Europe/Athens',
    v.first, v.last, v.phone, v.dob::date, v_admin
  from (values
    -- already out on the road
    ('ΡΕΚ 4821', 'Kritamos Beach Hotel',  '214', 'out',      -5,  2, 'Lena',    'Brandt',    '+4917632440118', '1988-03-14'),
    ('ΡΕΒ 7310', 'Ammos Bay Suites',      '108', 'out',      -4,  1, 'Marcus',  'Whitfield', '+447700148223',  '1979-11-02'),
    ('ΡΕΗ 8802', 'Nostos Village Resort', '512', 'out',      -6,  0, 'Sophie',  'Lemaire',   '+33612447901',   '1991-06-23'),
    ('ΧΝΕ 6473', 'Elia Sunrise Hotel',    '033', 'out',      -2,  4, 'Daan',    'Vermeulen', '+31646118207',   '1985-01-30'),
    ('ΗΡΚ 5528', 'Kritamos Beach Hotel',  '119', 'out',      -3,  0, 'Giulia',  'Ferrari',   '+393401882470',  '1993-09-08'),
    -- going out today
    ('ΗΡΤ 1094', 'Kritamos Beach Hotel',  '221', 'booked',    0,  5, 'Anders',  'Nilsson',   '+46701224580',   '1982-04-19'),
    ('ΧΝΑ 2047', 'Ammos Bay Suites',      '402', 'booked',    0,  3, 'Katarzyna','Nowak',    '+48601447112',   '1990-12-05'),
    ('ΑΝΖ 3167', 'Elia Sunrise Hotel',    '017', 'booked',    0,  7, 'Tomás',   'Ferreira',  '+351912440883',  '1976-07-27'),
    -- still ahead
    ('ΗΡΤ 9015', 'Nostos Village Resort', '308', 'booked',    2,  9, 'Ελένη',   'Παπαδάκη',  '+306944118207',  '1987-02-11'),
    ('ΡΕΚ 6640', 'Kritamos Beach Hotel',  '145', 'booked',    3,  8, 'Michael', 'O''Connor', '+353861447025',  '1974-05-16'),
    -- back already
    ('ΡΕΒ 7311', 'Ammos Bay Suites',      '206', 'returned', -12, -6, 'Hanna',  'Virtanen',  '+358441182204',  '1995-08-21'),
    ('ΧΝΑ 2046', 'Nostos Village Resort', '410', 'returned', -10, -4, 'Pieter', 'de Vries',  '+31651447390',   '1968-10-03')
  ) as v(plate, hotel, room, status, starts, ends, first, last, phone, dob)
  join public.cars c on c.plate = v.plate
  join public.hotels h on h.name = v.hotel;

  -- Every rental needs a main driver: the eligibility guard counts them, and a
  -- pickup screen with no driver on it is not a screenshot of anything.
  insert into public.booking_drivers
    (booking_id, is_main, first_name, last_name, dob,
     licence_number, licence_country, licence_issued_on, licence_expires_on, ocr_reviewed)
  select
    b.id, true, b.cust_first, b.cust_last, b.cust_dob,
    -- Invented licence numbers, in a shape that is obviously not anybody's.
    'DL' || lpad((row_number() over (order by b.start_date, b.ref) * 7331)::text, 8, '0'),
    case
      when b.cust_phone like '+49%' then 'DE' when b.cust_phone like '+44%' then 'GB'
      when b.cust_phone like '+33%' then 'FR' when b.cust_phone like '+31%' then 'NL'
      when b.cust_phone like '+39%' then 'IT' when b.cust_phone like '+46%' then 'SE'
      when b.cust_phone like '+48%' then 'PL' when b.cust_phone like '+351%' then 'PT'
      when b.cust_phone like '+353%' then 'IE' when b.cust_phone like '+358%' then 'FI'
      else 'GR' end,
    b.cust_dob + interval '21 years',
    current_date + interval '4 years',
    true
  from public.bookings b
  where b.kind = 'rental';

  -- One pickup already under way, on a car going out this morning. The damage
  -- step is only reachable once a pickup handover exists, and the damage
  -- diagram is the screen that replaces the paper agreement, so without this
  -- the pickup screenshot is a file-upload box and nothing else. The marks are
  -- pre-existing: scuffs the previous renter left, which is exactly what a rep
  -- is recording at that moment.
  insert into public.handovers (booking_id, kind, by_profile, fuel_eighths)
  select b.id, 'pickup', v_admin, 8
  from public.bookings b
  join public.cars c on c.id = b.car_id
  where c.plate = 'ΗΡΤ 1094';

  insert into public.damage_marks
    (handover_id, car_id, view, x, y, mark_type, note, pre_existing)
  select h.id, b.car_id, m.view, m.x, m.y, m.mark_type, m.note, true
  from public.handovers h
  join public.bookings b on b.id = h.booking_id
  join public.cars c on c.id = b.car_id
  cross join (values
    ('front', 0.6200, 0.4100, 'scratch', 'Γρατζουνιά στον προφυλακτήρα'),
    ('left',  0.4100, 0.5500, 'dent',    'Μικρό βαθούλωμα, πόρτα οδηγού'),
    ('rear',  0.3000, 0.6200, 'chip',    'Πετραδάκι στο πίσω φανάρι')
  ) as m(view, x, y, mark_type, note)
  where c.plate = 'ΗΡΤ 1094' and h.kind = 'pickup';

  -- Cash is recorded, never processed (docs/01-DECISIONS.md §25). A rental that
  -- has already gone out was paid in full at the desk.
  update public.bookings
  set collected = total, paid = true, pay_method = 'cash'
  where status in ('out', 'returned');

  -- One car off the road. `block_reason` is admin-only and a rep must never
  -- see it. To a rep this car is simply not available on those dates.
  insert into public.bookings
    (car_id, kind, status, start_date, end_date, block_reason, created_by)
  select c.id, 'block', 'blocked', current_date + 1, current_date + 3,
         'Σέρβις: αλλαγή ελαστικών', v_admin
  from public.cars c where c.plate = 'ΑΝΚ 2288';
end $$;
