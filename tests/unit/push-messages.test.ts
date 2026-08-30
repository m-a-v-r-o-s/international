import { describe, expect, test } from 'vitest'
import { isNotificationLang, translate } from '@/lib/push/messages'
import el from '../../messages/el.json'
import en from '../../messages/en.json'

// The service worker (public/sw.js) is outside next-intl's reach entirely, so
// the SENDER translates and the worker only displays. That makes this the one
// place a hard-coded user-facing string could hide, which is what these tests
// are for.

describe('the recipient\'s own language', () => {
  test('a Greek rep gets Greek and an English one gets English', () => {
    expect(translate('el', 'push.morning.title')).toBe(el.push.morning.title)
    expect(translate('en', 'push.morning.title')).toBe(en.push.morning.title)
    expect(el.push.morning.title).not.toBe(en.push.morning.title)
  })

  test('an unknown language falls back to Greek, the default of the business', () => {
    expect(translate('de', 'push.evening.title')).toBe(el.push.evening.title)
    expect(translate('', 'push.evening.title')).toBe(el.push.evening.title)
  })

  test('only the two languages the app actually has are languages', () => {
    expect(isNotificationLang('el')).toBe(true)
    expect(isNotificationLang('en')).toBe(true)
    expect(isNotificationLang('de')).toBe(false)
  })
})

describe('ICU, not string replacement', () => {
  test('the plural resolves in each language rather than printing its source', () => {
    for (const lang of ['el', 'en']) {
      const one = translate(lang, 'push.exceptions.title', { n: 1 })
      const many = translate(lang, 'push.exceptions.title', { n: 3 })

      expect(one).not.toContain('plural')
      expect(one).toContain('1')
      expect(many).toContain('3')
      // Greek's plural rules are not English's; what matters is that each
      // language chose a form of its own rather than both getting the source.
      expect(one).not.toBe(many)
    }
  })

  test('an exception type prints as the words the boss sees on A6', () => {
    expect(translate('en', 'admin.exceptions.type.new_damage'))
      .toBe(en.admin.exceptions.type.new_damage)
    expect(translate('el', 'admin.exceptions.type.fuel_short'))
      .toBe(el.admin.exceptions.type.fuel_short)
  })
})

describe('a missing key is visible, not silent', () => {
  test('it renders as the path rather than as an empty notification', () => {
    // tests/unit/messages-parity.test.ts is what stops this happening; this is
    // about what a scheduled job does if it ever did, and the answer is not
    // "crash" and not "send a blank push".
    expect(translate('el', 'push.nothing.here')).toBe('[push.nothing.here]')
    expect(translate('en', 'push.morning')).toBe('[push.morning]')
  })
})
