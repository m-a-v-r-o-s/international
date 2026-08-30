'use client'

import { useTranslations } from 'next-intl'
import type { CategoryRow } from '@/lib/supabase/database.types'

/**
 * A plain GET form: the range and filters live in the URL, so a rep can share
 * a link, use the back button, or refresh without losing their search — no
 * client state to keep in sync with the server-rendered results.
 */
export function FilterForm({
  categories, from, to, searchParams,
}: {
  categories: CategoryRow[]
  from: string
  to: string
  searchParams: Record<string, string | undefined>
}) {
  const t = useTranslations('availability')
  const tc = useTranslations('common')

  return (
    <form className="ir-card flex flex-col gap-3 p-4" aria-label={t('filtersLabel')}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="ir-label" htmlFor="from">{t('from')}</label>
          <input id="from" name="from" type="date" defaultValue={from} className="ir-field" required />
        </div>
        <div>
          <label className="ir-label" htmlFor="to">{t('to')}</label>
          <input id="to" name="to" type="date" defaultValue={to} className="ir-field" required />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="ir-label" htmlFor="category">{t('category')}</label>
          <select id="category" name="category" defaultValue={searchParams.category ?? ''} className="ir-field">
            <option value="">{t('anyCategory')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
        </div>
        <div>
          <label className="ir-label" htmlFor="transmission">{t('transmissionLabel')}</label>
          <select id="transmission" name="transmission" defaultValue={searchParams.transmission ?? ''} className="ir-field">
            <option value="">{t('any')}</option>
            <option value="manual">{t('transmission.manual')}</option>
            <option value="automatic">{t('transmission.automatic')}</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 items-end">
        <div>
          <label className="ir-label" htmlFor="seats">{t('minSeats')}</label>
          <input
            id="seats" name="seats" type="number" min={1} max={9}
            defaultValue={searchParams.seats ?? ''} className="ir-field"
          />
        </div>
        <label className="flex min-h-12 items-center gap-2.5 text-[1.0625rem] text-ink">
          <input
            type="checkbox" name="aircon" value="1"
            defaultChecked={searchParams.aircon === '1'}
            className="size-5 rounded border-control"
          />
          {t('aircon')}
        </label>
      </div>

      <button type="submit" className="ir-btn-primary">{tc('continue')}</button>
    </form>
  )
}
