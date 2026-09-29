'use client'

import { useActionState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { categoryName } from '@/lib/fleet/categories'
import { FormActions } from '@/components/FormActions'
import { setPriceRow, setExtraDayRate, type FormState } from './actions'
import type { CategoryRow } from '@/lib/supabase/database.types'

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const

export type PriceRowData = { category_id: string; days: number; total: number }
export type ExtraDayData = { category_id: string; price: number }

/**
 * The 8×7 grid of totals plus the extra-day rate (docs/04-SCREENS.md, A4).
 * One row per category, one save per row — pasting 56 numbers across 56
 * separate taps is not a real workflow, so each category's week is one form.
 * Every total is a whole euro integer, on screen and in the database — never
 * cents, never a fraction.
 */
export function PriceGridRow({
  periodId, category, rows, extra,
}: {
  periodId: string
  category: CategoryRow
  rows: PriceRowData[]
  extra: ExtraDayData | undefined
}) {
  const t = useTranslations('admin.pricing')
  const te = useTranslations('errors')
  const locale = useLocale()
  const byDay = new Map(rows.map((r) => [r.days, r.total]))

  const [state, formAction] = useActionState<FormState, FormData>(async (_prev, formData) => {
    // One submit writes all 7 day totals, then the extra-day rate — the
    // engine reads them as independent rows, but the admin edits a week at once.
    for (const day of DAYS) {
      const value = formData.get(`day-${day}`)
      const fd = new FormData()
      fd.set('period_id', periodId)
      fd.set('category_id', category.id)
      fd.set('days', String(day))
      fd.set('total', String(value))
      const result = await setPriceRow(undefined, fd)
      if (result?.error) return result
    }

    const fd = new FormData()
    fd.set('period_id', periodId)
    fd.set('category_id', category.id)
    fd.set('price', String(formData.get('extra')))
    return setExtraDayRate(undefined, fd)
  }, undefined)

  return (
    <form action={formAction} className="ir-card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-semibold">{category.code}</span>
        <span className="text-[0.8125rem] text-ink-soft">{categoryName(category, locale)}</span>
      </div>

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger mb-2 !py-1.5 !text-[0.8125rem]" role="alert">
          {te(state.error)}
        </p>
      ) : null}

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {DAYS.map((day) => (
          <label key={day} className="flex flex-col gap-1">
            <span className="text-[0.75rem] text-ink-soft">{t('day', { n: day })}</span>
            <input
              type="number" step={1} min={0} name={`day-${day}`}
              defaultValue={byDay.get(day)}
              aria-label={t('totalForDays', { n: day, category: category.code })}
              className="ir-field !min-h-10 !px-2 !text-[0.9375rem]"
            />
          </label>
        ))}
        <label className="flex flex-col gap-1">
          <span className="text-[0.75rem] text-ink-soft">{t('extraShort')}</span>
          <input
            type="number" step={1} min={0} name="extra"
            defaultValue={extra?.price}
            aria-label={t('extraDayRateFor', { category: category.code })}
            className="ir-field !min-h-10 !px-2 !text-[0.9375rem]"
          />
        </label>
      </div>

      <div className="mt-3">
        <FormActions label={t('saveRow')} variant="quiet" saved={state && !state.error} />
      </div>
    </form>
  )
}
