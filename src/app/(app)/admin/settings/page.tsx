import type { Metadata } from 'next'
import { getTranslations, getFormatter } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { SignOutButton } from '@/components/SignOutButton'
import { vapidPublicKey } from '@/lib/push/keys'
import {
  contractReadiness, parseCompany, REQUIRED_FOR_CONTRACT, type RequiredCompanyField,
} from '@/lib/contract/company'
import { CompanyForm } from './CompanyForm'
import { FuelChargeForm, PurgeForm, RetentionForm, WindowsForm } from './RetentionForms'
import { ClearLedgerForm } from '../customers/LedgerForms'
import { NotificationPreferences } from '../../settings/NotificationPreferences'
import { PushToggle } from '../../settings/PushToggle'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminSettings')
  return { title: t('title') }
}

/**
 * A10 · Settings, now complete.
 *
 * docs/04-SCREENS.md puts four things here: company legal details, the
 * bilingual contract terms, the licence retention window, and the default
 * pick-up and drop-off windows. The first two came forward to Phase 4 with the
 * PDF that has nowhere else to get a letterhead from; the other two are here.
 *
 * The retention section is the GDPR obligation in §25 made visible: the window
 * the sweep applies, what is due under it right now, and what the last purge
 * did. `orphans` is shown when it is not zero because the honest thing to do
 * with licence images whose booking has vanished is to say they exist — the
 * sweep will not touch them, since its predicate is positive and never a
 * negation.
 *
 * The banner at the top is the honest state of the project: client items 5
 * (the paper agreement and its terms, both languages) and 7 (company legal
 * details) have not arrived, so until the boss pastes them in, every contract
 * the app produces is stamped DRAFT.
 *
 * The danger zone at the very bottom holds the customer ledger's
 * three-confirmation clear-everything button (§25a, §30), moved here from
 * A11 Customers. It is the one irreversible, whole-table action in the admin
 * area, so it gets its own red-accented section below every other control on
 * the page rather than sitting on the ledger screen a rep might also open.
 * The ledger's own screen lives at /admin/customers; there is no pointer to
 * it here any more, only this danger-zone action.
 *
 * Language, notifications and account used to live on a second page at
 * /settings, reachable only from the header's globe link — a boss following
 * the sidebar's own "Settings" entry landed here instead and never saw them.
 * They're folded in below so the sidebar has exactly one settings screen;
 * /settings now redirects here for an admin.
 */
export default async function AdminSettingsPage() {
  const staff = await requireAdmin()
  const t = await getTranslations('adminSettings')
  const ts = await getTranslations('settings')
  const tc = await getTranslations('common')
  const tl = await getTranslations('adminLedger')
  const format = await getFormatter()
  const supabase = await supabaseServer()

  const [{ data }, { data: retention }, { data: ledger }, { data: profile }] = await Promise.all([
    supabase.from('app_settings')
      .select('id, company, licence_retention_months, pickup_window, dropoff_window, fuel_charge_per_eighth')
      .eq('id', 1).maybeSingle(),
    supabase.rpc('admin_licence_retention_status'),
    supabase.rpc('admin_customer_ledger_status'),
    supabase.from('profiles').select('notify_incidents').eq('id', staff.id).maybeSingle(),
  ])

  const incidents = (profile as { notify_incidents?: boolean } | null)?.notify_incidents ?? true

  const company = parseCompany(data?.company)
  const readiness = contractReadiness(company)

  const settings = data as {
    licence_retention_months: number; pickup_window: string; dropoff_window: string
    fuel_charge_per_eighth: number
  } | null
  const status = ((retention ?? []) as {
    retention_months: number; cutoff: string; due_count: number; orphan_count: number
    oldest_due: string | null; purged_drivers: number; last_purge_at: string | null
  }[])[0]
  const ledgerTotal = ((ledger ?? []) as { total: number }[])[0]?.total ?? 0

  const [pickupFrom = '08:30', pickupTo = '11:30'] = (settings?.pickup_window ?? '').split('-')
  const [dropoffFrom = '18:00', dropoffTo = '21:00'] = (settings?.dropoff_window ?? '').split('-')

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('intro')}</p>
      </div>

      <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="lang-heading">
        <h2 id="lang-heading" className="text-[1.125rem] font-semibold">{ts('language')}</h2>
        <p className="text-[0.9375rem] text-ink-soft">{ts('languageHelp')}</p>
        <LanguageSwitcher />
      </section>

      <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="notify-heading">
        <h2 id="notify-heading" className="text-[1.125rem] font-semibold">{ts('notifications')}</h2>
        <PushToggle publicKey={vapidPublicKey()} />
        <hr className="border-line" />
        <NotificationPreferences incidents={incidents} />
      </section>

      <section className="ir-card flex flex-col gap-3 p-5" aria-labelledby="acct-heading">
        <h2 id="acct-heading" className="text-[1.125rem] font-semibold">{ts('account')}</h2>
        <SignOutButton className="ir-btn-quiet">{tc('signOut')}</SignOutButton>
      </section>

      {readiness.ready ? (
        <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">{t('ready')}</p>
      ) : (
        <div className="ir-notice border-warn bg-warn-tint text-warn" role="status">
          <p className="font-semibold">{t('notReadyTitle')}</p>
          <p className="mt-1">{t('notReadyBody')}</p>
          <ul className="mt-2 list-disc pl-5">
            {readiness.missing.map((field) => (
              <li key={field}>{t(`field.${field}` as `field.${RequiredCompanyField}`)}</li>
            ))}
          </ul>
          <p className="mt-2">
            {t('notReadyCount', {
              done: REQUIRED_FOR_CONTRACT.length - readiness.missing.length,
              total: REQUIRED_FOR_CONTRACT.length,
            })}
          </p>
        </div>
      )}

      <CompanyForm company={company} />

      <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="windows-heading">
        <h2 id="windows-heading" className="text-[1.0625rem] font-semibold">
          {t('windowsTitle')}
        </h2>
        <WindowsForm windows={{ pickupFrom, pickupTo, dropoffFrom, dropoffTo }} />
      </section>

      <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="fuel-heading">
        <h2 id="fuel-heading" className="text-[1.0625rem] font-semibold">
          {t('fuelChargeTitle')}
        </h2>
        <p className="text-[0.9375rem] text-ink-soft">{t('fuelChargeIntro')}</p>
        <FuelChargeForm perEighth={settings?.fuel_charge_per_eighth ?? 10} />
      </section>

      <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="retention-heading">
        <h2 id="retention-heading" className="text-[1.0625rem] font-semibold">
          {t('retentionTitle')}
        </h2>
        <p className="text-[0.9375rem] text-ink-soft">{t('retentionIntro')}</p>

        <RetentionForm months={settings?.licence_retention_months ?? 24} />

        {status ? (
          <>
            <hr className="border-line" />
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[0.9375rem] sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="text-ink-soft">{t('retentionCutoff')}</dt>
                <dd>
                  {format.dateTime(new Date(`${status.cutoff}T00:00:00`), { dateStyle: 'medium' })}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink-soft">{t('retentionDue')}</dt>
                <dd>{status.due_count}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink-soft">{t('retentionPurgedTotal')}</dt>
                <dd>{status.purged_drivers}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink-soft">{t('retentionLastPurge')}</dt>
                <dd>
                  {status.last_purge_at
                    ? format.dateTime(new Date(status.last_purge_at), {
                        dateStyle: 'medium', timeStyle: 'short',
                      })
                    : t('retentionNeverPurged')}
                </dd>
              </div>
            </dl>

            {status.orphan_count > 0 ? (
              <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
                {t('retentionOrphans', { n: status.orphan_count })}
              </p>
            ) : null}

            <PurgeForm dueCount={status.due_count} />
          </>
        ) : null}
      </section>

      <section
        className="ir-card flex flex-col gap-4 border-danger p-4"
        aria-labelledby="danger-zone-heading"
      >
        <h2 id="danger-zone-heading" className="text-[1.0625rem] font-semibold text-danger">
          {t('dangerZoneTitle')}
        </h2>
        <div className="flex flex-col gap-3">
          <h3 className="text-[0.9375rem] font-semibold">{tl('clearTitle')}</h3>
          <p className="text-[0.9375rem] text-ink-soft">{tl('clearIntro')}</p>
          <ClearLedgerForm total={ledgerTotal} />
        </div>
      </section>
    </div>
  )
}
