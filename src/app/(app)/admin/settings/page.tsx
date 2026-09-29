import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { SignOutButton } from '@/components/SignOutButton'
import { contractReadiness, parseCompany } from '@/lib/contract/company'
import { FuelChargeForm, WindowsForm } from './RetentionForms'
import { ClearLedgerForm } from '../customers/LedgerForms'
import { SettingsLinkCard, SettingsSummary } from './SettingsLinkCard'
import { Disclosure } from '@/components/Disclosure'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminSettings')
  return { title: t('title') }
}

/**
 * A10 · Settings.
 *
 * The settings big enough to be their own screen — hotels, groups, staff,
 * company/contract terms, licence retention — moved out to /admin/hotels,
 * /admin/categories, /admin/users, /admin/settings/company and
 * /admin/settings/retention, each reachable from a clickable card below
 * rather than embedded inline.
 * What is left here is either small (language, the two single-purpose forms
 * for the pick-up/drop-off windows and the fuel-shortfall rate) or the one
 * destructive, whole-table action (the ledger's clear-everything button).
 * Those three stay on this page rather than getting their own screen, but
 * each is collapsed behind a Disclosure so the page reads at the same
 * height as the link cards around it — a boss opens one by tapping its
 * name, same as everything else here. The danger zone additionally sits
 * below everything else and stays visibly red even collapsed, so it is
 * never the first thing tapped by reflex.
 *
 * Account — sign out — is the very last thing on the page, below the danger
 * zone. On a screen this long, having it near the top meant a boss reaching
 * for a setting further down could tap it by mistake on the way past.
 */
export default async function AdminSettingsPage() {
  await requireAdmin()
  const t = await getTranslations('adminSettings')
  const ts = await getTranslations('settings')
  const tc = await getTranslations('common')
  const tl = await getTranslations('adminLedger')
  const th = await getTranslations('admin.hotels')
  const tcat = await getTranslations('admin.categories')
  const tu = await getTranslations('admin.users')

  const supabase = await supabaseServer()

  const [
    { data },
    { data: retention },
    { data: ledger },
    { count: hotelsCount },
    { count: categoriesCount },
    { data: staff },
    { data: bin },
  ] = await Promise.all([
    supabase.from('app_settings')
      .select('id, company, pickup_window, dropoff_window, fuel_charge_per_eighth')
      .eq('id', 1).maybeSingle(),
    supabase.rpc('admin_licence_retention_status'),
    supabase.rpc('admin_customer_ledger_status'),
    supabase.from('hotels').select('id', { count: 'exact', head: true }),
    supabase.from('categories').select('id', { count: 'exact', head: true }),
    supabase.rpc('admin_list_users'),
    supabase.rpc('admin_recycle_bin'),
  ])

  const readiness = contractReadiness(parseCompany(data?.company))

  const settings = data as {
    pickup_window: string; dropoff_window: string; fuel_charge_per_eighth: number
  } | null
  const status = ((retention ?? []) as { due_count: number }[])[0]
  const ledgerTotal = ((ledger ?? []) as { total: number }[])[0]?.total ?? 0

  const [pickupFrom = '08:30', pickupTo = '11:30'] = (settings?.pickup_window ?? '').split('-')
  const [dropoffFrom = '18:00', dropoffTo = '21:00'] = (settings?.dropoff_window ?? '').split('-')

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('intro')}</p>
      </div>

      <section className="ir-card flex flex-col gap-3 p-4" aria-labelledby="lang-heading">
        <h2 id="lang-heading" className="text-[1.0625rem] font-semibold">{ts('language')}</h2>
        <p className="text-[0.9375rem] opacity-80">{ts('languageHelp')}</p>
        <LanguageSwitcher />
      </section>

      <SettingsLinkCard
        href="/admin/hotels"
        title={th('title')}
        description={th('intro')}
        meta={th('count', { n: hotelsCount ?? 0 })}
      />

      <SettingsLinkCard
        href="/admin/categories"
        title={tcat('title')}
        description={tcat('intro')}
        meta={String(categoriesCount ?? 0)}
      />

      <SettingsLinkCard
        href="/admin/users"
        title={tu('title')}
        description={tu('intro')}
        meta={tu('count', { n: staff?.length ?? 0 })}
      />

      <SettingsLinkCard
        href="/admin/settings/company"
        title={t('companyCardTitle')}
        description={t('companyCardDesc')}
        warning={readiness.ready ? undefined : t('notReadyTitle')}
      />

      <Disclosure
        className="group"
        summary={<SettingsSummary title={t('windowsTitle')} description={t('windowsDesc')} />}
      >
        <WindowsForm windows={{ pickupFrom, pickupTo, dropoffFrom, dropoffTo }} />
      </Disclosure>

      <Disclosure
        className="group"
        summary={<SettingsSummary title={t('fuelChargeTitle')} description={t('fuelChargeDesc')} />}
      >
        <div className="flex flex-col gap-4">
          <p className="text-[0.9375rem] text-ink-soft">{t('fuelChargeIntro')}</p>
          <FuelChargeForm perEighth={settings?.fuel_charge_per_eighth ?? 10} />
        </div>
      </Disclosure>

      <SettingsLinkCard
        href="/admin/settings/retention"
        title={t('retentionTitle')}
        description={t('retentionIntro')}
        meta={status && status.due_count > 0 ? `${t('retentionDue')}: ${status.due_count}` : undefined}
      />

      <SettingsLinkCard
        href="/admin/settings/recycle-bin"
        title={t('binTitle')}
        description={t('binDesc')}
        meta={t('binCount', { n: bin?.length ?? 0 })}
      />

      <Disclosure
        summary={<SettingsSummary title={t('dangerZoneTitle')} description={t('dangerZoneDesc')} />}
        className="group border-danger bg-danger"
        summaryClassName="text-white"
      >
        <div className="flex flex-col gap-3 rounded-field bg-surface p-4 text-ink">
          <h3 className="text-[0.9375rem] font-semibold">{tl('clearTitle')}</h3>
          <p className="text-[0.9375rem] text-ink-soft">{tl('clearIntro')}</p>
          <ClearLedgerForm total={ledgerTotal} />
        </div>
      </Disclosure>

      <section className="ir-card flex flex-col gap-3 p-4" aria-labelledby="acct-heading">
        <h2 id="acct-heading" className="text-[1.0625rem] font-semibold">{ts('account')}</h2>
        <SignOutButton className="ir-btn-quiet">{tc('signOut')}</SignOutButton>
      </section>
    </div>
  )
}
