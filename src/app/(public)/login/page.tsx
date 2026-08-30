import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { CodeForm, PasswordForm } from './LoginForm'

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
  const manager = as === 'manager'

  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-8">
      <header>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-[0.9375rem] text-ink-soft">{t('intro')}</p>
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

      <div className="ir-card p-5">{manager ? <CodeForm /> : <PasswordForm />}</div>

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
