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

        <figure className="mt-6 flex flex-col items-center gap-2">
          <div className="flex gap-2">
            <img
              src="/heritage-shopfront.webp" width={480} height={443}
              alt={t('altShopfront')} className="w-20 rounded-card border border-line shadow-sm"
            />
            <img
              src="/heritage-outside-shop.webp" width={480} height={430}
              alt={t('altOutside')} className="w-20 rounded-card border border-line shadow-sm"
            />
            <img
              src="/heritage-reception.webp" width={480} height={443}
              alt={t('altReception')} className="w-20 rounded-card border border-line shadow-sm"
            />
          </div>
          <figcaption className="text-[0.8125rem] text-ink-soft">{t('galleryCaption')}</figcaption>
        </figure>
      </main>
      <Footer />
    </div>
  )
}
