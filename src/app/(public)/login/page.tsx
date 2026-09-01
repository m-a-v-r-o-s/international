import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { HeritageSlideshow } from '@/components/HeritageSlideshow'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { CodeForm, PasswordForm } from './LoginForm'

const HERITAGE_IMAGES = [
  { src: '/heritage-shopfront.webp', alt: '', width: 480, height: 443 },
  { src: '/heritage-outside-shop.webp', alt: '', width: 480, height: 430 },
  { src: '/heritage-reception.webp', alt: '', width: 480, height: 443 },
]

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('login')
  return { title: t('title') }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string; reason?: string }>
}) {
  const { as, reason } = await searchParams
  const t = await getTranslations('login')
  const te = await getTranslations('errors')
  const tapp = await getTranslations('app')
  const manager = as === 'manager'

  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-8">
      <header>
        {/* Intrinsic size given, so the card below does not jump when the
            logo loads on a hotel's wifi. */}
        <img
          src="/logo.webp"
          width={750}
          height={250}
          alt={tapp('logoAlt')}
          className="h-auto w-full max-w-[17.5rem]"
        />
        <h1 className="sr-only">{t('title')}</h1>
      </header>

      {reason === 'device' ? (
        <p className="ir-notice border-warn bg-warn-tint text-ink" role="status">
          {te('deviceChanged')}
        </p>
      ) : null}

      {/* Two named doors rather than one that guesses. Asking the server which
          door an address belongs to would leak exactly the thing the
          no-enumeration rule protects. */}
      <nav className="grid grid-cols-2 gap-1 rounded-field bg-brand-tint p-1"
           aria-label={t('title')}>
        <Tab href="/login" active={!manager} label={t('staffTab')} />
        <Tab href="/login?as=manager" active={manager} label={t('managerTab')} />
      </nav>

      {/* A translucent scrim over the whole photo would fight itself — the
          more visible the photo, the less reliable the text on top of it. So
          the photo runs full width and full strength as its own band at the
          top of the card, and the fields keep the plain, already-tested
          surface below it untouched. */}
      <div className="ir-card overflow-hidden">
        <HeritageSlideshow images={HERITAGE_IMAGES} decorative />
        <div className="p-5">{manager ? <CodeForm /> : <PasswordForm />}</div>
      </div>

      <LanguageSwitcher />
    </main>
  )
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-[2.75rem] items-center justify-center rounded-md text-[1rem] font-semibold ${
        active ? 'bg-surface text-brand shadow-sm' : 'text-brand hover:bg-surface/60'
      }`}
    >
      {label}
    </Link>
  )
}
