import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, getFormatter } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { PurgeForm, RetentionForm } from '../RetentionForms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminSettings')
  return { title: t('retentionTitle') }
}

/**
 * The GDPR obligation in §25 made visible, on its own screen. It used to sit
 * inline on A10 Settings (see the note at the top of ../page.tsx); the boss
 * found that page too long to scan, so Settings now links here instead of
 * embedding it.
 *
 * `orphans` is shown when it is not zero because the honest thing to do with
 * licence images whose booking has vanished is to say they exist — the sweep
 * will not touch them, since its predicate is positive and never a negation.
 */
export default async function AdminRetentionSettingsPage() {
  await requireAdmin()
  const t = await getTranslations('adminSettings')
  const format = await getFormatter()
  const supabase = await supabaseServer()

  const [{ data }, { data: retention }] = await Promise.all([
    supabase.from('app_settings').select('licence_retention_months').eq('id', 1).maybeSingle(),
    supabase.rpc('admin_licence_retention_status'),
  ])

  const months = (data as { licence_retention_months: number } | null)?.licence_retention_months ?? 24
  const status = ((retention ?? []) as {
    retention_months: number; cutoff: string; due_count: number; orphan_count: number
    oldest_due: string | null; purged_drivers: number; last_purge_at: string | null
  }[])[0]

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/settings" className="text-[0.9375rem] text-brand underline-offset-2 hover:underline">
        ← {t('title')}
      </Link>

      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('retentionTitle')}</h1>
        <p className="text-ink-soft">{t('retentionIntro')}</p>
      </div>

      <section className="ir-card flex flex-col gap-4 p-4">
        <RetentionForm months={months} />

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
    </div>
  )
}
