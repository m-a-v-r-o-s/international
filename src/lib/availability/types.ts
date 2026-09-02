/** Shared shapes for R2 (Availability) and R3 (New booking). */
export type CarWithSpecs = {
  id: string
  plate: string
  photo_path: string | null
  model_id: string
  /** The MODEL's photo, not the plate's — R2 groups by model and shows one picture per model. */
  model_photo_path: string | null
  make: string
  model: string
  category_id: string
  category_code: string
  transmission: 'manual' | 'automatic'
  fuel_type: 'petrol' | 'diesel' | 'hybrid' | 'electric'
  seats: number
  doors: number
}

/** A car is free for the whole range only if none of its occupied dates fall in it. */
export function isFreeForRange(occupiedDates: string[], from: string, to: string): boolean {
  return !occupiedDates.some((d) => d >= from && d <= to)
}

/** One car model on the availability screen, with the plates behind its count. */
export type ModelAvailability = {
  modelId: string
  make: string
  model: string
  categoryId: string
  photoPath: string | null
  transmission: 'manual' | 'automatic'
  seats: number
  /** Every non-archived plate of this model, in the order the fleet query returned. */
  plates: { id: string; plate: string; free: boolean }[]
  total: number
  free: number
  /** The plate a `Book` press actually books — the first free one, or null. */
  firstFreeCarId: string | null
}

export type CategoryAvailability = {
  categoryId: string
  models: ModelAvailability[]
  total: number
  free: number
}

/**
 * The fleet, grouped the way R2 reads it: category → model → a count of the
 * plates free for the WHOLE range.
 *
 * Why models and not plates. The old screen listed every plate, which meant
 * six near-identical Fiat Pandas in a row and roughly a hundred rows for this
 * fleet. A guest asks for a Panda, not for PL-0042; the rep needs to know
 * whether there is one and how many are left, and only then which one.
 *
 * "Free" is free for every day of the range, never partially free, because
 * that is what a booking needs — one row holds one car for the whole rental
 * (docs/06-IMPLEMENTATION-NOTES.md). A plate free for four days of a six-day
 * search is not an offer the rep can make, so it does not count toward the
 * number they read out loud.
 *
 * This says nothing §8 forbids. A count of free plates is derived from exactly
 * the occupied dates availability() already hands back, and carries no rep, no
 * customer, no reason and no times — an admin's service block and another
 * rep's booking both simply fail to be free.
 *
 * Pure, and deliberately so: no date arithmetic and no database, so it is
 * unit-testable and the inclusive-day rule stays where it belongs, in the
 * server's availability().
 */
export function groupFleet(
  cars: CarWithSpecs[],
  occupied: Map<string, string[]>,
  from: string,
  to: string,
): CategoryAvailability[] {
  const byCategory = new Map<string, Map<string, ModelAvailability>>()

  for (const car of cars) {
    let models = byCategory.get(car.category_id)
    if (!models) byCategory.set(car.category_id, models = new Map())

    let entry = models.get(car.model_id)
    if (!entry) {
      models.set(car.model_id, entry = {
        modelId: car.model_id,
        make: car.make,
        model: car.model,
        categoryId: car.category_id,
        photoPath: car.model_photo_path,
        transmission: car.transmission,
        seats: car.seats,
        plates: [],
        total: 0,
        free: 0,
        firstFreeCarId: null,
      })
    }

    const free = isFreeForRange(occupied.get(car.id) ?? [], from, to)
    entry.plates.push({ id: car.id, plate: car.plate, free })
    entry.total += 1
    if (free) {
      entry.free += 1
      entry.firstFreeCarId ??= car.id
    }
  }

  return [...byCategory.entries()].map(([categoryId, models]) => {
    const list = [...models.values()]
    return {
      categoryId,
      models: list,
      total: list.reduce((n, m) => n + m.total, 0),
      free: list.reduce((n, m) => n + m.free, 0),
    }
  })
}

/**
 * The cars an in-progress rental may be swapped into as part of an extension
 * (docs/01-DECISIONS.md §18).
 *
 * Two rules decide the set, and the second is the one that is easy to get
 * wrong. Same category — the guard trigger raises IR111 otherwise. And free
 * for the WHOLE rental, from the original pickup date through the new return
 * date, not merely for the days being added: one booking row holds one car, so
 * a swap moves the entire rental onto the new plate and the exclusion
 * constraint judges it over the entire range
 * (docs/06-IMPLEMENTATION-NOTES.md). Checking only the extension window offers
 * the rep cars that are then refused with a double-booking error at the moment
 * they confirm, in front of the guest.
 *
 * `occupied` must therefore have been loaded over that same whole range; a
 * narrower window cannot see the clash it is meant to rule out.
 */
export function swapCandidates<T extends { id: string; category_id: string }>(
  cars: T[],
  occupied: Map<string, string[]>,
  opts: { currentCarId: string; categoryId: string; start: string; end: string },
): T[] {
  return cars.filter((car) =>
    car.category_id === opts.categoryId
    && car.id !== opts.currentCarId
    && isFreeForRange(occupied.get(car.id) ?? [], opts.start, opts.end))
}

/**
 * Whether the rental's CURRENT car is free through the new return date.
 *
 * Only the days after the original end date count: the booking legitimately
 * holds its own car through the dates it already has, and those show up in
 * availability() as occupied on exactly that car.
 */
export function currentCarFreeThrough(
  occupiedDates: string[], currentEnd: string, newEnd: string,
): boolean {
  return !occupiedDates.some((d) => d > currentEnd && d <= newEnd)
}
