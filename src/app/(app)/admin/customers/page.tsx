import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, getFormatter } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { LedgerSearchForm } from './LedgerForms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminLedger')
  return { title: t('title') }
}

/**
 * A11 · Ψηφιακό πελατολόγιο (docs/01-DECISIONS.md §25a, promoted by §30,
 * search widened by §41).
 *
 * It was a section of A10 Settings until the owner asked for it in the
 * sidebar. Nothing about what it does changed in the move — the status figures
 * still come from admin_customer_ledger_status() — but it stops being
 * something you have to remember is at the bottom of another screen. A store
 * of names, dates of birth and licence numbers that the owner chose to keep
 * with no expiry (§25a decision 1) should be one tap from anywhere, not filed
 * under configuration.
 *
 * Search sits above the status figures, not below: it is the thing an admin
 * reaches for first when a returning guest is on the phone, and only
 * occasionally the lead-in to erasing someone. The three-confirmation
 * clear-the-whole-ledger button lives on A10 Settings instead, in its danger
 * zone at the bottom of that screen — a destructive, whole-table action sits
 * better next to the other irreversible admin actions than on the day-to-day
 * ledger screen a rep might also land on.
 */
export default async function AdminCustomersPage() {
  await requireAdmin()
  const t = await getTranslations('adminLedger')
  const ts = await getTranslations('adminSettings')
  const format = await getFormatter()
  const supabase = await supabaseServer()

  const { data: ledger } = await supabase.rpc('admin_customer_ledger_status')

  const ledgerStatus = ((ledger ?? []) as {
    total: number; with_licence_images: number; linked_bookings: number
    oldest_seen: string | null; newest_seen: string | null
    last_cleared_at: string | null; last_erasure_at: string | null
  }[])[0]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('intro')}</p>
      </div>

      <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="ledger-search-heading">
        <h2 id="ledger-search-heading" className="text-[1.0625rem] font-semibold">
          {t('searchTitle')}
        </h2>
        <p className="text-[0.9375rem] text-ink-soft">{t('searchIntro')}</p>
        <LedgerSearchForm />
      </section>

      {ledgerStatus ? (
        <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="ledger-status-heading">
          <h2 id="ledger-status-heading" className="text-[1.0625rem] font-semibold">
            {t('statusTitle')}
          </h2>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[0.9375rem] sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-ink-soft">{t('total')}</dt>
              <dd>{ledgerStatus.total}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-soft">{t('withImages')}</dt>
              <dd>{ledgerStatus.with_licence_images}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-soft">{t('oldest')}</dt>
              <dd>
                {ledgerStatus.oldest_seen
                  ? format.dateTime(new Date(ledgerStatus.oldest_seen), { dateStyle: 'medium' })
                  : '–'}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-soft">{t('lastCleared')}</dt>
              <dd>
                {ledgerStatus.last_cleared_at
                  ? format.dateTime(new Date(ledgerStatus.last_cleared_at), {
                      dateStyle: 'medium', timeStyle: 'short',
                    })
                  : t('neverCleared')}
              </dd>
            </div>
          </dl>
          <p className="text-[0.9375rem] text-ink-soft">
            {t('retentionPointer')}{' '}
            <Link href="/admin/settings" className="text-brand underline underline-offset-2">
              {ts('title')}
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  )
}
