import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

/**
 * The credit links to akosds.com on every project, every footer.
 */
export async function Footer() {
  const t = await getTranslations('footer')

  return (
    <footer className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-6 text-[0.875rem] text-ink-soft">
      <nav className="flex gap-4" aria-label={t('navLabel')}>
        <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
          {t('privacy')}
        </Link>
        <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
          {t('terms')}
        </Link>
      </nav>
      <p>
        {t.rich('credit', {
          year: new Date().getFullYear(),
          link: (chunks) => (
            <a
              href="https://akosds.com"
              rel="noopener"
              className="underline underline-offset-2 hover:text-ink"
            >
              {chunks}
            </a>
          ),
        })}
      </p>
    </footer>
  )
}
