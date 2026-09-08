import { describe, expect, test } from 'vitest'
import { splitGrossVat, VAT_RATE_PERCENT } from '@/lib/invoicing/vat'

// The rate is fixed, not passed in, so the only thing worth testing is the
// split itself: does it match the worked example in §43/§44, and do the
// parts always sum back to the gross to the cent.

describe('splitGrossVat', () => {
  test('the rate is 17, matching Kos, not the 24 in the provider\'s own samples', () => {
    expect(VAT_RATE_PERCENT).toBe(17)
  })

  test('the §43 worked example: €170 gross gives €145.30 net + €24.70 VAT', () => {
    expect(splitGrossVat(170)).toEqual({ grossCents: 17000, netCents: 14530, vatCents: 2470 })
  })

  test('a gross that does not divide evenly still sums back to the cent', () => {
    expect(splitGrossVat(1)).toEqual({ grossCents: 100, netCents: 85, vatCents: 15 })
  })

  test('zero is not a special case', () => {
    expect(splitGrossVat(0)).toEqual({ grossCents: 0, netCents: 0, vatCents: 0 })
  })

  test('net + VAT sums to the gross to the cent, across a run of whole-euro amounts', () => {
    for (let euros = 1; euros <= 500; euros++) {
      const { grossCents, netCents, vatCents } = splitGrossVat(euros)
      expect(netCents + vatCents).toBe(grossCents)
    }
  })
})
