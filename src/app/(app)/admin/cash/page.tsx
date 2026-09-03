import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { formatEuros } from '@/lib/money'
import { supabaseServer } from '@/lib/supabase/server'
import { ConfirmForm } from './ConfirmForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.cash')
  return { title: t('title') }
}

/**
 * A12 · Cash (docs/04-SCREENS.md, docs/01-DECISIONS.md §31) — every hand-over
 * receipt no admin has confirmed yet, oldest first. This is the ONE place
 * that clears a rep's own cash-in-hand figure now: admin_confirm_cash_handover()
 * is the only door onto `confirmed_by`, which is withheld from `authenticated`
 * by column grant, so admin_pending_cash_handovers() is the only way even the
 * admin sees which receipts are still open.
 *
 * Almost always this list has at most one row per rep — the usual single
 * hand-over at the end of the morning shift. A second row for the same rep
 * the same day is the rare, legitimate case this screen exists for: a
 * night-shift pickup or a delayed payment handed over again before the boss
 * has confirmed the first.
 */
export default async function CashPage() {
  await requireAdmin()
  const t = await getTranslations('admin.cash')
  const supabase = await supabaseServer()

  const { data } = await supabase.rpc('admin_pending_cash_handovers')
  const rows = data ?? []

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Athens',
    })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('subtitle')}</p>
      </div>

      {rows.length === 0 ? (
        <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[0.9375rem]">
            <thead>
              <tr className="border-b border-line-strong text-[0.8125rem] uppercase tracking-wide text-ink-soft">
                <th className="py-2 pr-3 font-medium">{t('rep')}</th>
                <th className="py-2 pr-3 font-medium">{t('amount')}</th>
                <th className="py-2 pr-3 font-medium">{t('handedAt')}</th>
                <th className="py-2 pr-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 font-medium">{row.rep_name ?? '–'}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatEuros(row.amount)}</td>
                  <td className="py-2 pr-3 text-ink-soft tabular-nums">{fmtTime(row.handed_at)}</td>
                  <td className="py-2 pr-3">
                    <ConfirmForm id={row.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
