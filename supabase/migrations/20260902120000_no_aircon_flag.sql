-- ═════════════════════════════════════════════════════════════════════════════
-- 0032 · Every car has air conditioning, so the flag goes
--
-- `car_models.aircon` has been `not null default true` since 0003, and the
-- owner confirmed (2 Sep 2026) what the default was already saying: every car
-- in this fleet has A/C. Nothing in the data ever said otherwise.
--
-- A column that is true on every row is not a fact about a car — it is a
-- question the app keeps asking and always answers the same way. It cost the
-- rep a filter checkbox on R2 that could only ever narrow the fleet to itself,
-- and the admin a tick box on the model form with one correct setting.
--
-- Dropping it rather than leaving it defaulted is the point: a column that
-- exists invites a false row. If a car without A/C is ever bought, this comes
-- back as a deliberate migration and the screens come back with it.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.car_models drop column aircon;
