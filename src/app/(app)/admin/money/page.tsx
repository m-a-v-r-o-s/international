import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { todayAthens } from '@/lib/dates'
import { formatEuros } from '@/lib/money'
import { supabaseServer } from '@/lib/supabase/server'
import { SettleForm } from './SettleForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.money')
  return { title: t('title') }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A14 · Money (docs/01-DECISIONS.md §47). What actually came in over a period,
 * cash and card, with gratis beside it and never inside it; then every
 * pay-after balance still open, each settled Paid or Gratis in one tap.
 * Defaults to this month so far.
 */
export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAdmin()
  const t = await getTranslations('admin.money')
  const tb = await getTranslations('admin.bookings')
  const te = await getTranslations('errors')
  const params = await searchParams
  const today = todayAthens()
  const from = DATE.test(params.from ?? '') ? params.from! : `${today.slice(0, 8)}01`
  const to = DATE.test(params.to ?? '') ? params.to! : today
  const supabase = await supabaseServer()

  const [{ data: summaryRows, error: summaryError }, { data: openRows }] = await Promise.all([
    supabase.rpc('admin_money_summary', { p_from: from, p_to: to }),
    supabase.rpc('admin_open_pay_after'),
  ])
  const summary = summaryRows?.[0] ?? { cash: 0, card: 0, gratis: 0 }
  const open = openRows ?? []
  const owed = open.reduce((sum, row) => sum + row.balance, 0)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('subtitle')}</p>
      </div>

      <form className="flex flex-wrap items-end gap-2">
        <div>
          <label className="ir-label" htmlFor="from">{t('from')}</label>
          <input id="from" name="from" type="date" defaultValue={from} className="ir-field" />
        </div>
        <div>
          <label className="ir-label" htmlFor="to">{t('to')}</label>
          <input id="to" name="to" type="date" defaultValue={to} className="ir-field" />
        </div>
        <button type="submit" className="ir-btn-quiet !w-auto">{t('show')}</button>
      </form>

      {summaryError ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te('IR104')}</p>
      ) : null}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="ir-card flex flex-col gap-1 p-4">
          <dt className="text-ink-soft">{t('received')}</dt>
          <dd className="text-[1.5rem] font-bold tabular-nums">{formatEuros(summary.cash + summary.card)}</dd>
          <dd className="text-[0.9375rem] text-ink-soft tabular-nums">
            {tb('payMethodCash')} {formatEuros(summary.cash)} · {tb('payMethodCard')} {formatEuros(summary.card)}
          </dd>
        </div>
        <div className="ir-card flex flex-col gap-1 p-4">
          <dt className="text-ink-soft">{t('owed')}</dt>
          <dd className="text-[1.5rem] font-bold tabular-nums">{formatEuros(owed)}</dd>
          <dd className="text-[0.9375rem] text-ink-soft">{t('owedHint')}</dd>
        </div>
        <div className="ir-card flex flex-col gap-1 p-4">
          <dt className="text-ink-soft">{t('gratis')}</dt>
          <dd className="text-[1.5rem] font-bold tabular-nums">{formatEuros(summary.gratis)}</dd>
          <dd className="text-[0.9375rem] text-ink-soft">{t('gratisHint')}</dd>
        </div>
      </dl>

      <section className="flex flex-col gap-3" aria-labelledby="unpaid-heading">
        <h2 id="unpaid-heading" className="text-[1.25rem] font-semibold">{t('unpaidTitle')}</h2>
        {open.length === 0 ? (
          <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">{t('unpaidEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[0.9375rem]">
              <thead>
                <tr className="border-b border-line-strong text-[0.8125rem] uppercase tracking-wide text-ink-soft">
                  <th className="py-2 pr-3 font-medium">{t('booking')}</th>
                  <th className="py-2 pr-3 font-medium">{t('guest')}</th>
                  <th className="py-2 pr-3 font-medium">{t('dates')}</th>
                  <th className="py-2 pr-3 font-medium">{t('rep')}</th>
                  <th className="py-2 pr-3 font-medium">{t('amount')}</th>
                  <th className="py-2 pr-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {open.map((row) => (
                  <tr key={row.booking_id} className="border-b border-line align-top last:border-0">
                    <td className="py-2 pr-3">
                      <Link href={`/admin/bookings/${row.booking_id}`} className="text-brand underline underline-offset-2">
                        {row.ref}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-medium">{row.cust_name || '–'}</span>
                      {row.cust_phone ? <span className="block text-ink-soft tabular-nums">{row.cust_phone}</span> : null}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{row.start_date} – {row.end_date}</td>
                    <td className="py-2 pr-3">{row.rep_name ?? '–'}</td>
                    <td className="py-2 pr-3 font-semibold tabular-nums">{formatEuros(row.balance)}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <SettleForm bookingId={row.booking_id} outcome="paid" method="cash" label={t('paidCash')} />
                        <SettleForm bookingId={row.booking_id} outcome="paid" method="card" label={t('paidCard')} />
                        <SettleForm
                          bookingId={row.booking_id} outcome="gratis" label={t('gratisAction')}
                          confirmText={t('gratisConfirm', { amount: formatEuros(row.balance), name: row.cust_name || row.ref })}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
