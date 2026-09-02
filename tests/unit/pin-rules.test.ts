import { describe, expect, test } from 'vitest'
import {
  isChosenPinLength, isPredictablePin, isWellFormedPin,
} from '@/lib/auth/pin'

/**
 * §38 lets a rep choose their own PIN, which is the first time a PIN in this
 * system has not come out of crypto.randomInt. These are the two rules that
 * stand in for what randomness used to guarantee, so they are asserted rather
 * than assumed.
 */
describe('what a rep may choose as a PIN', () => {
  test('the reader still takes four to eight digits, because old PINs exist', () => {
    // isWellFormedPin is what the login field uses. Narrowing it to six would
    // lock out any account issued a PIN before §38.
    expect(isWellFormedPin('1234')).toBe(true)
    expect(isWellFormedPin('12345678')).toBe(true)
    expect(isWellFormedPin('123')).toBe(false)
    expect(isWellFormedPin('123456789')).toBe(false)
    expect(isWellFormedPin('12345a')).toBe(false)
  })

  test('the writer takes six digits and nothing else', () => {
    expect(isChosenPinLength('284917')).toBe(true)
    expect(isChosenPinLength('2849')).toBe(false)
    expect(isChosenPinLength('28491777')).toBe(false)
    expect(isChosenPinLength('28491a')).toBe(false)
    expect(isChosenPinLength('')).toBe(false)
    expect(isChosenPinLength(' 284917 ')).toBe(false)
  })

  describe('predictable shapes are refused', () => {
    test('repeated blocks', () => {
      expect(isPredictablePin('000000')).toBe(true)
      expect(isPredictablePin('777777')).toBe(true)
      expect(isPredictablePin('121212')).toBe(true)
      expect(isPredictablePin('454545')).toBe(true)
      expect(isPredictablePin('123123')).toBe(true)
      expect(isPredictablePin('480480')).toBe(true)
    })

    test('runs, up and down, but not wrapping past 9', () => {
      expect(isPredictablePin('123456')).toBe(true)
      expect(isPredictablePin('456789')).toBe(true)
      expect(isPredictablePin('654321')).toBe(true)
      expect(isPredictablePin('987654')).toBe(true)
      // 890123 contains a run but only by wrapping, and nobody reaches for it
      // first. Named here so the boundary is a decision rather than a bug.
      expect(isPredictablePin('890123')).toBe(false)
    })

    test('the short list of leaked favourites the rules above miss', () => {
      expect(isPredictablePin('112233')).toBe(true)
      expect(isPredictablePin('123321')).toBe(true)
      expect(isPredictablePin('159753')).toBe(true)
    })

    test('an ordinary PIN passes', () => {
      expect(isPredictablePin('284917')).toBe(false)
      expect(isPredictablePin('730264')).toBe(false)
      expect(isPredictablePin('100000')).toBe(false)
      expect(isPredictablePin('135791')).toBe(false)  // regular, but not reached for
    })

    test('a wrong-length PIN is a length problem, not a weak one', () => {
      // The action reports length first; this must not double up on it and it
      // must not divide by a length that is not six.
      expect(isPredictablePin('1111')).toBe(false)
      expect(isPredictablePin('1234')).toBe(false)
      expect(isPredictablePin('11111111')).toBe(false)
      expect(isPredictablePin('')).toBe(false)
    })
  })
})
