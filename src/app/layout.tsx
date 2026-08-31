import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { getLocale } from '@/i18n/locale'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app')
  return {
    title: { default: t('name'), template: `%s · ${t('short')}` },
    description: t('description'),
    applicationName: t('name'),
    // Internal tool: it should never turn up in a search result.
    robots: { index: false, follow: false, nocache: true },
    icons: { icon: '/icon.svg' },
    openGraph: {
      title: t('name'),
      description: t('description'),
      images: ['/opengraph-image.png'],
    },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#10456a',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  const t = await getTranslations('common')

  return (
    <html lang={locale}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3
                       focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-3
                       focus:text-ink focus:shadow-lg"
          >
            {t('skipToContent')}
          </a>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
