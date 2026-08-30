import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Footer } from '@/components/Footer'

/** Branded, in the reader's language, and never the framework default. */
export default async function NotFound() {
  const t = await getTranslations('notFound')

  return (
    <div className="flex min-h-dvh flex-col">
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-5 py-12">
        <p aria-hidden="true" className="text-[3rem] font-bold leading-none text-brand-tint">404</p>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('body')}</p>
        <Link href="/" className="ir-btn-primary mt-2">{t('home')}</Link>
      </main>
      <Footer />
    </div>
  )
}
