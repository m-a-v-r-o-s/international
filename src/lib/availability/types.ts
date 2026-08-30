/** Shared shapes for R2 (Availability) and R3 (New booking). */
export type CarWithSpecs = {
  id: string
  plate: string
  photo_path: string | null
  make: string
  model: string
  category_id: string
  category_code: string
  transmission: 'manual' | 'automatic'
  fuel_type: 'petrol' | 'diesel' | 'hybrid' | 'electric'
  seats: number
  doors: number
  aircon: boolean
}

export type AvailabilityFilters = {
  from: string
  to: string
  categoryId?: string
  transmission?: 'manual' | 'automatic'
  seats?: number
  aircon?: boolean
}

/** A car is free for the whole range only if none of its occupied dates fall in it. */
export function isFreeForRange(occupiedDates: string[], from: string, to: string): boolean {
  return !occupiedDates.some((d) => d >= from && d <= to)
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
