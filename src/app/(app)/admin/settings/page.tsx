import type { Metadata } from 'next'
import { getTranslations, getFormatter } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import {
  contractReadiness, parseCompany, REQUIRED_FOR_CONTRACT, type RequiredCompanyField,
} from '@/lib/contract/company'
import { CompanyForm } from './CompanyForm'
import { PurgeForm, RetentionForm, WindowsForm } from './RetentionForms'
import { ClearLedgerForm, LedgerErasureForm } from './LedgerForms'

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
 */
export default async function AdminSettingsPage() {
  await requireAdmin()
  const t = await getTranslations('adminSettings')
  const tl = await getTranslations('adminLedger')
  const format = await getFormatter()
  const supabase = await supabaseServer()

  const [{ data }, { data: retention }, { data: ledger }] = await Promise.all([
    supabase.from('app_settings')
      .select('id, company, licence_retention_months, pickup_window, dropoff_window')
      .eq('id', 1).maybeSingle(),
    supabase.rpc('admin_licence_retention_status'),
    supabase.rpc('admin_customer_ledger_status'),
  ])

  const company = parseCompany(data?.company)
  const readiness = contractReadiness(company)

  const settings = data as {
    licence_retention_months: number; pickup_window: string; dropoff_window: string
  } | null
  const status = ((retention ?? []) as {
    retention_months: number; cutoff: string; due_count: number; orphan_count: number
    oldest_due: string | null; purged_drivers: number; last_purge_at: string | null
  }[])[0]

  const ledgerStatus = ((ledger ?? []) as {
    total: number; with_licence_images: number; linked_bookings: number
    oldest_seen: string | null; newest_seen: string | null
    last_cleared_at: string | null; last_erasure_at: string | null
  }[])[0]

  const [pickupFrom = '08:30', pickupTo = '11:30'] = (settings?.pickup_window ?? '').split('-')
  const [dropoffFrom = '18:00', dropoffTo = '21:00'] = (settings?.dropoff_window ?? '').split('-')

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('intro')}</p>
      </div>

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

      {/*
        Ψηφιακό πελατολόγιο (docs/01-DECISIONS.md §25a).

        Placed directly under the licence-retention section on purpose: these
        are the two stores of guest personal data this system holds, and the
        boss should see them together and see how differently they behave. One
        has a window and empties itself; the other has neither and empties only
        when he says so. The line that says exactly that is `ledgerNoWindow`,
        and it is not softened.
      */}
      <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="ledger-heading">
        <h2 id="ledger-heading" className="text-[1.0625rem] font-semibold">
          {tl('title')}
        </h2>
        <p className="text-[0.9375rem] text-ink-soft">{tl('intro')}</p>
        <p className="ir-notice border-warn bg-warn-tint text-warn">{tl('noWindow')}</p>

        {ledgerStatus ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[0.9375rem] sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-ink-soft">{tl('total')}</dt>
              <dd>{ledgerStatus.total}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-soft">{tl('withImages')}</dt>
              <dd>{ledgerStatus.with_licence_images}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-soft">{tl('oldest')}</dt>
              <dd>
                {ledgerStatus.oldest_seen
                  ? format.dateTime(new Date(ledgerStatus.oldest_seen), { dateStyle: 'medium' })
                  : '—'}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-soft">{tl('lastCleared')}</dt>
              <dd>
                {ledgerStatus.last_cleared_at
                  ? format.dateTime(new Date(ledgerStatus.last_cleared_at), {
                      dateStyle: 'medium', timeStyle: 'short',
                    })
                  : tl('neverCleared')}
              </dd>
            </div>
          </dl>
        ) : null}

        <hr className="border-line" />
        <h3 className="text-[1rem] font-semibold">{tl('erasureTitle')}</h3>
        <p className="text-[0.9375rem] text-ink-soft">{tl('erasureIntro')}</p>
        <LedgerErasureForm />

        <hr className="border-line" />
        <h3 className="text-[1rem] font-semibold text-danger">{tl('clearTitle')}</h3>
        <p className="text-[0.9375rem] text-ink-soft">{tl('clearIntro')}</p>
        <ClearLedgerForm total={ledgerStatus?.total ?? 0} />
      </section>
    </div>
  )
}
