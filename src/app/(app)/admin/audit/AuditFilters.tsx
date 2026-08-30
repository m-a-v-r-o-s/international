'use client'

import { useTranslations } from 'next-intl'

/**
 * A9's filters: actor, entity and date (docs/04-SCREENS.md).
 *
 * A plain GET form, so a filtered view is a URL the boss can bookmark or send,
 * the back button works, and there is no client state to get out of step with
 * what is on screen. Same shape as A5's and A6's filters.
 */
export function AuditFilters({
  entities, staff, current,
}: {
  entities: string[]
  staff: { id: string; full_name: string }[]
  current: { actor: string | null; entity: string | null; from: string | null; to: string | null }
}) {
  const t = useTranslations('admin.audit')

  const entityLabel = (entity: string) => {
    const key = `entity.${entity}`
    // The list comes from what the log actually holds, so a table that gains
    // auditing later shows its own name rather than a missing-key error.
    return t.has(key as 'entity.bookings') ? t(key as 'entity.bookings') : entity
  }

  return (
    <form method="get" className="ir-card flex flex-col gap-3 p-4" aria-label={t('filtersLabel')}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="ir-label" htmlFor="actor">{t('filterActor')}</label>
          <select id="actor" name="actor" className="ir-field" defaultValue={current.actor ?? ''}>
            <option value="">{t('anyActor')}</option>
            {staff.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name || p.id}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="ir-label" htmlFor="entity">{t('filterEntity')}</label>
          <select id="entity" name="entity" className="ir-field" defaultValue={current.entity ?? ''}>
            <option value="">{t('anyEntity')}</option>
            {entities.map((e) => (
              <option key={e} value={e}>{entityLabel(e)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="ir-label" htmlFor="from">{t('filterFrom')}</label>
          <input
            id="from" name="from" type="date" className="ir-field"
            defaultValue={current.from ?? ''}
          />
        </div>

        <div>
          <label className="ir-label" htmlFor="to">{t('filterTo')}</label>
          <input
            id="to" name="to" type="date" className="ir-field" defaultValue={current.to ?? ''}
          />
        </div>
      </div>

      <button type="submit" className="ir-btn-quiet">{t('apply')}</button>
    </form>
  )
}
