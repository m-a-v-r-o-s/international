import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { CarWithSpecs } from './types'

export type AvailabilityRow = { car_id: string; occupied_dates: string[] }

/**
 * Every non-archived car with its specs, joined in application code because
 * `cars`, `car_models` and `categories` each carry their own column grants
 * and RLS policies — a client-side join keeps every one of those in force,
 * where a Postgres view would flatten them into one grant to reason about.
 */
export async function loadCarsWithSpecs(
  supabase: SupabaseClient<Database>,
): Promise<CarWithSpecs[]> {
  const [{ data: cars }, { data: models }, { data: categories }] = await Promise.all([
    supabase.from('cars')
      .select('id, plate, model_id, photo_path, archived_at')
      .is('archived_at', null),
    supabase.from('car_models')
      .select('id, make, model, category_id, transmission, fuel_type, seats, doors, aircon'),
    supabase.from('categories').select('id, code, sort_order').order('sort_order'),
  ])

  const modelById = new Map((models ?? []).map((m) => [m.id, m]))
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c]))

  const out: CarWithSpecs[] = []
  for (const car of cars ?? []) {
    const model = modelById.get(car.model_id)
    if (!model) continue
    const category = categoryById.get(model.category_id)
    if (!category) continue

    out.push({
      id: car.id,
      plate: car.plate,
      photo_path: car.photo_path,
      make: model.make,
      model: model.model,
      category_id: model.category_id,
      category_code: category.code,
      transmission: model.transmission,
      fuel_type: model.fuel_type,
      seats: model.seats,
      doors: model.doors,
      aircon: model.aircon,
    })
  }
  return out
}

/** The occupied-dates map for a range, keyed by car id. availability() itself decides what leaks — nothing but dates. */
export async function loadAvailability(
  supabase: SupabaseClient<Database>, from: string, to: string,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase.rpc('availability', { from_date: from, to_date: to })
  if (error) throw error
  return new Map((data ?? []).map((row: AvailabilityRow) => [row.car_id, row.occupied_dates]))
}
