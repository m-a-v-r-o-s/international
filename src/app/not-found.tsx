import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Footer } from '@/components/Footer'
import { HeritageSlideshow } from '@/components/HeritageSlideshow'

/** Branded, in the reader's language, and never the framework default. */
export default async function NotFound() {
  const t = await getTranslations('notFound')

  const images = [
    { src: '/heritage-shopfront.webp', alt: t('altShopfront'), width: 480, height: 443 },
    { src: '/heritage-outside-shop.webp', alt: t('altOutside'), width: 480, height: 430 },
    { src: '/heritage-reception.webp', alt: t('altReception'), width: 480, height: 443 },
  ]

  return (
    <div className="flex min-h-dvh flex-col">
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-5 py-12">
        <p aria-hidden="true" className="text-[3rem] font-bold leading-none text-brand-tint">404</p>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('body')}</p>
        <Link href="/" className="ir-btn-primary mt-2">{t('home')}</Link>

        <HeritageSlideshow
          images={images}
          className="mt-6 w-40 self-center rounded-card border border-line shadow-sm"
        />
      </main>
      <Footer />
    </div>
  )
}
