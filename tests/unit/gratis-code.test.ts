import { describe, expect, test } from 'vitest'
import { isObviousCode } from '@/lib/auth/gratis'

// §48: ten thousand codes, so the handful everyone tries first are refused.
describe('the gratis code', () => {
  test('repeats and runs are refused', () => {
    for (const code of ['0000', '7777', '1234', '6789', '4321', '9876', '0123']) {
      expect(isObviousCode(code), code).toBe(true)
    }
  })

  test('anything else is accepted', () => {
    for (const code of ['2580', '1357', '0912', '1122', '8642']) {
      expect(isObviousCode(code), code).toBe(false)
    }
  })
})
