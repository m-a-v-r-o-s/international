import { z } from 'zod'

/**
 * Money is a whole euro integer everywhere in this app — never cents, never
 * a fraction. These are the only two places that format or validate one.
 */
export function formatEuros(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '–'
  return `€${amount}`
}

export const euroAmountSchema = z.coerce.number().int().min(0).max(100_000)
