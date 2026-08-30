import { cookies } from 'next/headers'

/**
 * Language is a property of the person, not of the URL.
 *
 * The reps and the boss each set theirs once (docs/01-DECISIONS.md §24) and it
 * follows them everywhere, so there is no /el or /en prefix to carry around —
 * which also means the installed Android app has no language baked into its
 * start URL. The preference lives on `profiles.lang`; this cookie is the copy
 * the edge can read without a database round trip on every request.
 */
export const LOCALES = ['el', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'el'
export const LOCALE_COOKIE = 'ir_locale'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

export async function getLocale(): Promise<Locale> {
  const store = await cookies()
  const value = store.get(LOCALE_COOKIE)?.value
  return isLocale(value) ? value : DEFAULT_LOCALE
}
