import type { Locale } from '@/i18n/locale'

/**
 * A category's name in the reader's own language.
 *
 * `categories` carries `name_el` and `name_en` side by side because the admin
 * edits both (A5) — but every screen except that editor shows exactly one of
 * them, and which one is not a property of the screen. Language here is a
 * property of the person (docs/01-DECISIONS.md §24), so it follows their
 * locale, the same one the surrounding page is already translated with.
 *
 * Structural on purpose: it takes the two columns rather than a `CategoryRow`,
 * so a narrower select is just as welcome.
 */
export function categoryName(
  category: { name_el: string; name_en: string },
  locale: Locale,
): string {
  return locale === 'el' ? category.name_el : category.name_en
}
