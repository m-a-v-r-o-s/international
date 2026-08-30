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
