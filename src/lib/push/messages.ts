import { createTranslator } from 'next-intl'
import el from '../../../messages/el.json'
import en from '../../../messages/en.json'

/**
 * The wording of a notification, in the recipient's own language.
 *
 * A notification is rendered by the service worker, which is outside
 * next-intl's reach entirely — `public/sw.js` is a plain script with no React,
 * no provider and no request locale. So the SENDER does the translating: it
 * reads the same two catalogues every screen uses, picks the one matching that
 * person's `profiles.lang`, and puts finished text in the payload. The worker
 * displays what it is given and contains no user-facing string of its own.
 *
 * It goes through next-intl's own `createTranslator` rather than a hand-rolled
 * {placeholder} replace, because these messages are ICU like every other
 * message in the catalogues — "3 new exceptions" is a plural, and Greek's
 * plural rules are not English's. A private formatter would print the raw ICU
 * source the first time somebody wrote a correct message, and would quietly
 * make tests/unit/messages-parity.test.ts's placeholder check a check on
 * something no longer true.
 *
 * The same reasoning as the contract (src/lib/contract/labels.ts); the
 * difference is only that a contract needs both languages at once and a
 * notification needs one.
 */
const CATALOGUES = { el, en } as const

export type NotificationLang = keyof typeof CATALOGUES

export function isNotificationLang(value: string): value is NotificationLang {
  return value in CATALOGUES
}

export function translate(
  lang: string,
  path: string,
  values: Record<string, string | number> = {},
): string {
  const locale: NotificationLang = isNotificationLang(lang) ? lang : 'el'

  const t = createTranslator({
    locale,
    messages: CATALOGUES[locale],
    // A missing key looks like a bug rather than printing an empty
    // notification, and it is not a crash: a scheduled job that dies on one
    // bad string sends nothing to anybody. next-intl's default onError still
    // logs it, which in a cron log is exactly where it should appear.
    // tests/unit/messages-parity.test.ts is what stops it happening at all.
    getMessageFallback: ({ key }) => `[${key}]`,
  })

  return t(path as Parameters<typeof t>[0], values)
}
