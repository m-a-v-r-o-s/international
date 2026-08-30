import { getTranslations } from 'next-intl/server'
import { getLocale, LOCALES } from '@/i18n/locale'
import { setLocale } from '@/lib/actions/locale'

/**
 * Greek and English, switchable per user (docs/01-DECISIONS.md §24).
 *
 * A form rather than a client toggle: it works before hydration, it works with
 * a keyboard, and for a signed-in person it writes the choice back to their
 * profile so it follows them to the boss's desktop as well.
 */
export async function LanguageSwitcher() {
  const t = await getTranslations('common')
  const current = await getLocale()

  return (
    <form action={setLocale} className="flex items-center gap-2">
      <span className="text-[0.9375rem] text-ink-soft" id="lang-label">
        {t('language')}
      </span>
      <div role="group" aria-labelledby="lang-label" className="flex gap-1">
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="submit"
            name="locale"
            value={locale}
            aria-pressed={locale === current}
            className={`min-h-[2.75rem] rounded-md border px-4 text-[0.9375rem] font-medium ${
              locale === current
                ? 'border-brand bg-brand text-brand-ink'
                : 'border-control bg-surface text-ink hover:bg-brand-tint'
            }`}
          >
            {locale === 'el' ? t('greek') : t('english')}
          </button>
        ))}
      </div>
    </form>
  )
}
