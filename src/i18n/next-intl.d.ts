import type { Locale } from './locale'

/**
 * Teach next-intl the two locales this app actually has.
 *
 * Without this, `useLocale()` is typed `string` — which is how a screen ends
 * up picking a language with a loose comparison nobody can typecheck. See
 * `AppConfig` in use-intl; `Messages` is deliberately left alone.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale
  }
}
