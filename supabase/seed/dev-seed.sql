-- ═════════════════════════════════════════════════════════════════════════════
-- DEVELOPMENT SEED — PLACEHOLDER DATA, NOT THE CLIENT'S
--
-- Every name, plate, spec and price below is invented so that the engines and
-- screens have something to work against. The real ones are still outstanding
-- (docs/01-DECISIONS.md §28, HANDOFF.md "Blocked on the client"):
--
--   1. the 8 category names and which of the 20 models belong to each
--   2. model specs including tank size in litres
--   3. the 100-car fleet list
--   4. the price tables — at least one pricing period
--   6. the hotel list and rep assignments
--
-- When those arrive, replace this file's contents wholesale. Do NOT run it
-- against production, and do not let any of these numbers reach a quote the
-- client sees.
--
-- Category minimum ages follow docs/01-DECISIONS.md §11 — A and B at 21,
-- C to H at 23 — because those ARE decided, even though the names are not.
-- ═════════════════════════════════════════════════════════════════════════════

insert into public.categories (code, name_el, name_en, min_driver_age, min_licence_years, sort_order)
values
  ('A', 'Κατηγορία Α — PLACEHOLDER', 'Category A — PLACEHOLDER', 21, 1, 1),
  ('B', 'Κατηγορία Β — PLACEHOLDER', 'Category B — PLACEHOLDER', 21, 1, 2),
  ('C', 'Κατηγορία Γ — PLACEHOLDER', 'Category C — PLACEHOLDER', 23, 1, 3),
  ('D', 'Κατηγορία Δ — PLACEHOLDER', 'Category D — PLACEHOLDER', 23, 1, 4),
  ('E', 'Κατηγορία Ε — PLACEHOLDER', 'Category E — PLACEHOLDER', 23, 1, 5),
  ('F', 'Κατηγορία Ζ — PLACEHOLDER', 'Category F — PLACEHOLDER', 23, 1, 6),
  ('G', 'Κατηγορία Η — PLACEHOLDER', 'Category G — PLACEHOLDER', 23, 1, 7),
  ('H', 'Κατηγορία Θ — PLACEHOLDER', 'Category H — PLACEHOLDER', 23, 1, 8)
on conflict (code) do nothing;

-- Two models per category, placeholder specs.
insert into public.car_models (make, model, category_id, transmission, fuel_type, seats, doors, aircon, tank_litres)
select m.make, m.model, c.id, m.transmission, m.fuel_type, m.seats, m.doors, true, m.tank
from public.categories c
join (values
  ('A', 'Fiat',    'Panda',      'manual',    'petrol', 4, 5, 37.0),
  ('A', 'Hyundai', 'i10',        'manual',    'petrol', 4, 5, 36.0),
  ('B', 'Toyota',  'Yaris',      'manual',    'petrol', 5, 5, 42.0),
  ('B', 'Opel',    'Corsa',      'manual',    'petrol', 5, 5, 44.0),
  ('C', 'Toyota',  'Yaris Auto', 'automatic', 'petrol', 5, 5, 42.0),
  ('C', 'Peugeot', '208',        'manual',    'diesel', 5, 5, 44.0),
  ('D', 'Nissan',  'Qashqai',    'manual',    'diesel', 5, 5, 55.0),
  ('D', 'Jeep',    'Renegade',   'automatic', 'petrol', 5, 5, 48.0),
  ('E', 'Suzuki',  'Jimny',      'manual',    'petrol', 4, 3, 40.0),
  ('E', 'Dacia',   'Duster',     'manual',    'diesel', 5, 5, 50.0),
  ('F', 'Fiat',    '500C',       'manual',    'petrol', 4, 2, 35.0),
  ('F', 'Mini',    'Cooper Cab', 'automatic', 'petrol', 4, 2, 44.0),
  ('G', 'Toyota',  'Proace',     'manual',    'diesel', 9, 5, 70.0),
  ('G', 'Ford',    'Tourneo',    'manual',    'diesel', 8, 5, 70.0),
  ('H', 'Tesla',   'Model 3',    'automatic', 'electric', 5, 5, null),
  ('H', 'BMW',     'X1',         'automatic', 'diesel', 5, 5, 61.0)
) as m(code, make, model, transmission, fuel_type, seats, doors, tank)
  on m.code = c.code
on conflict (make, model) do nothing;

-- 96 placeholder plates, evenly spread across the models.
insert into public.cars (plate, model_id, year, colour)
select
  'PL-' || lpad(n::text, 4, '0'),
  m.id,
  2021 + (n % 4),
  (array['white','silver','grey','blue','red','black'])[1 + (n % 6)]
from generate_series(1, 96) as n
join lateral (
  select id, row_number() over (order by make, model) as rn from public.car_models
) m on m.rn = 1 + (n % 16)
on conflict (plate) do nothing;

insert into public.hotels (name, area)
values
  ('Hotel Placeholder One',   'Rethymno'),
  ('Hotel Placeholder Two',   'Chania'),
  ('Hotel Placeholder Three', 'Heraklion')
on conflict do nothing;

-- One season, four periods, roughly the shape described in
-- docs/01-DECISIONS.md §6 — low start, mid, peak, low end. The DATES are a
-- guess and the MONEY is invented.
insert into public.pricing_periods (season_year, name, start_date, end_date)
values
  (2027, 'Low start — PLACEHOLDER', '2027-05-01', '2027-06-15'),
  (2027, 'Mid — PLACEHOLDER',       '2027-06-16', '2027-07-31'),
  (2027, 'Peak — PLACEHOLDER',      '2027-08-01', '2027-09-15'),
  (2027, 'Low end — PLACEHOLDER',   '2027-09-16', '2027-10-31')
on conflict do nothing;

-- Totals for 1–7 days, plus the per-extra-day rate for 8+.
-- These are placeholders with a plausible shape only: the per-day rate eases off
-- with length, and peak costs more than low. The admin will type the real ones.
insert into public.price_rows (period_id, category_id, days, total)
select p.id, c.id, d.days,
       round(
         (25 + (c.sort_order - 1) * 9)               -- a base day rate per category, euros
         * (case p.name
              when 'Low start — PLACEHOLDER' then 1.00
              when 'Mid — PLACEHOLDER'       then 1.35
              when 'Peak — PLACEHOLDER'      then 1.90
              else 1.05 end)
         * d.days
         * (1 - 0.03 * (d.days - 1))                 -- longer rentals ease off
       )::integer
from public.pricing_periods p
cross join public.categories c
cross join generate_series(1, 7) as d(days)
where p.season_year = 2027
on conflict do nothing;

insert into public.price_extra_day (period_id, category_id, price)
select pr.period_id, pr.category_id, round(pr.total / 7.0 * 0.85)::integer
from public.price_rows pr
where pr.days = 7
on conflict do nothing;
