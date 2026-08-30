import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, getFormatter } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { Disclosure } from '@/components/Disclosure'
import { changedFields, type AuditRow } from '@/lib/audit/diff'
import { AuditFilters } from './AuditFilters'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.audit')
  return { title: t('title') }
}

const PAGE_SIZE = 50
const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A9 · Audit log. Admin-only, read-only, permanent (docs/04-SCREENS.md).
 *
 * Every write in this system has been logged since Phase 1 — actor, entity,
 * before, after, timestamp (docs/01-DECISIONS.md §19) — and until now there
 * was no way to read it that did not involve a SQL client. A permanent log
 * nobody can look at is a promise, not a control.
 *
 * WHAT IS DELIBERATELY NOT HERE: anything app.audit_redact() stripped on the
 * way in. pin_hash, licence_number, the two licence image paths, pdf_path,
 * signature_path and photo_path are absent from `before` and `after` because
 * the log records who did what, not a second copy of the personal data. This
 * screen does not join them back on from their source tables, and must not be
 * changed to — an audit screen that quietly re-assembles what the redaction
 * removed is the last place anybody would think to look for a leak.
 *
 * There is no export, no delete and no edit. `audit_log` is granted SELECT and
 * nothing else to any client role, so those are absent from the database as
 * well as from the screen.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAdmin()
  const t = await getTranslations('admin.audit')
  const format = await getFormatter()
  const params = await searchParams
  const supabase = await supabaseServer()

  const actor = UUID.test(params.actor ?? '') ? params.actor! : null
  const entity = (params.entity ?? '').trim() || null
  const from = DATE.test(params.from ?? '') ? params.from! : null
  const to = DATE.test(params.to ?? '') ? params.to! : null
  const page = Math.max(0, Math.min(Number(params.page) || 0, 1000))

  const [{ data: rows }, { data: entities }, { data: staff }] = await Promise.all([
    // One extra row, purely to find out whether there is another page. A
    // count(*) over a permanent log would get slower every month for an
    // answer nobody needs.
    supabase.rpc('admin_audit_log', {
      p_actor: actor,
      p_entity: entity,
      p_from: from,
      p_to: to,
      p_limit: PAGE_SIZE + 1,
      p_offset: page * PAGE_SIZE,
    }),
    supabase.rpc('admin_audit_entities'),
    supabase.from('profiles').select('id, full_name').order('full_name'),
  ])

  const all = (rows ?? []) as AuditRow[]
  const entries = all.slice(0, PAGE_SIZE)
  const hasMore = all.length > PAGE_SIZE

  // A table that gains auditing later shows its own name rather than a
  // missing-key error; the labelled ones read as the boss thinks of them.
  const entityLabel = (entity: string) => {
    const key = `entity.${entity}`
    return t.has(key as 'entity.bookings') ? t(key as 'entity.bookings') : entity
  }

  const query = (next: number) => {
    const sp = new URLSearchParams()
    if (actor) sp.set('actor', actor)
    if (entity) sp.set('entity', entity)
    if (from) sp.set('from', from)
    if (to) sp.set('to', to)
    if (next > 0) sp.set('page', String(next))
    const s = sp.toString()
    return s ? `/admin/audit?${s}` : '/admin/audit'
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('intro')}</p>
      </div>

      <AuditFilters
        entities={((entities ?? []) as { entity: string }[]).map((e) => e.entity)}
        staff={((staff ?? []) as { id: string; full_name: string }[])}
        current={{ actor, entity, from, to }}
      />

      {entries.length === 0 ? (
        <p className="text-ink-soft">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((row) => {
            const changes = changedFields(row)
            return (
              <li key={row.id} className="ir-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-[1.0625rem] font-semibold">
                    {entityLabel(row.entity)}
                    <span className="ml-2 text-[0.8125rem] font-normal text-ink-soft">
                      {t(`action.${row.action}`)}
                    </span>
                  </p>
                  <p className="text-[0.8125rem] text-ink-soft">
                    {format.dateTime(new Date(row.at), {
                      dateStyle: 'medium', timeStyle: 'medium',
                    })}
                  </p>
                </div>

                <p className="mt-1 text-[0.9375rem]">
                  <span className="text-ink-soft">{t('actor')} </span>
                  {row.actor_name || (row.actor_id ? t('unknownActor') : t('systemActor'))}
                </p>

                {row.entity_id ? (
                  <p className="mt-0.5 break-all font-mono text-[0.75rem] text-ink-soft">
                    {row.entity_id}
                  </p>
                ) : null}

                {changes.length > 0 ? (
                  <div className="mt-3">
                    <Disclosure summary={t('changes', { n: changes.length })}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-[0.875rem]">
                          <thead>
                            <tr className="border-b border-line text-ink-soft">
                              <th scope="col" className="py-1 pr-3 font-medium">{t('field')}</th>
                              <th scope="col" className="py-1 pr-3 font-medium">{t('before')}</th>
                              <th scope="col" className="py-1 font-medium">{t('after')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {changes.map((c) => (
                              <tr key={c.field} className="border-b border-line/60 align-top">
                                <th scope="row" className="py-1 pr-3 font-mono font-normal">
                                  {c.field}
                                </th>
                                <td className="py-1 pr-3 break-all text-ink-soft">
                                  {c.from ?? <span className="italic">{t('none')}</span>}
                                </td>
                                <td className="py-1 break-all">
                                  {c.to ?? <span className="italic">{t('none')}</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Disclosure>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {page > 0 || hasMore ? (
        <nav className="flex items-center justify-between gap-3" aria-label={t('pagination')}>
          {page > 0 ? (
            <Link href={query(page - 1)} className="ir-btn-quiet !w-auto">{t('newer')}</Link>
          ) : <span />}
          <span className="text-[0.875rem] text-ink-soft">{t('page', { n: page + 1 })}</span>
          {hasMore ? (
            <Link href={query(page + 1)} className="ir-btn-quiet !w-auto">{t('older')}</Link>
          ) : <span />}
        </nav>
      ) : null}
    </div>
  )
}
