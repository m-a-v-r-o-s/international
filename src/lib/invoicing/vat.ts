/**
 * §43/§44/§46: our prices are VAT-inclusive whole euros; the invoicing
 * provider wants net and VAT as separate figures, and never derives them
 * itself (it stores whatever it's given). Getting the split right, and
 * getting the parts to sum back to the gross to the cent, is ours alone.
 *
 * The rate is a constant, not a parameter, on purpose: Kos is a reduced-rate
 * island and the provider's own sample payloads assert 24, which is wrong
 * here. §43 already had this rate wrong once. There is nowhere in this
 * function for a caller, a default or a response to feed in the wrong one.
 *
 * Provider-agnostic on purpose (§43's "one interface, one adapter per
 * provider") — this is a business rule about our own prices, not a Wrapp
 * detail, so it lives above the adapter rather than inside it.
 */
export const VAT_RATE_PERCENT = 17

export function splitGrossVat(grossEuros: number): {
  grossCents: number
  netCents: number
  vatCents: number
} {
  const grossCents = Math.round(grossEuros * 100)
  const netCents = Math.round(grossCents / (1 + VAT_RATE_PERCENT / 100))

  return { grossCents, netCents, vatCents: grossCents - netCents }
}
