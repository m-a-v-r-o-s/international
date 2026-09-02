import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { Disclosure } from '@/components/Disclosure'
import { PeriodForm } from './PeriodForm'
import { PriceGridRow, PricePreview, type ExtraDayData, type PriceRowData } from './PriceGrid'
import { BulkPasteForm } from './BulkPasteForm'
import type { CategoryRow, Database } from '@/lib/supabase/database.types'

type PeriodRow = Database['public']['Tables']['pricing_periods']['Row']

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pricing')
  return { title: t('title') }
}

/**
 * A4 · Pricing periods, the 8×7 grid of totals, and the extra-day rate
 * (docs/04-SCREENS.md). Built ahead of the client's real numbers arriving —
 * this screen is what unblocks them sending the price tables at all
 * (HANDOFF.md). Every total on screen and in the database is a whole euro
 * integer — never cents, never a fraction.
 */
export default async function PricingPage() {
  await requireAdmin()
  const t = await getTranslations('admin.pricing')
  const supabase = await supabaseServer()

  const [{ data: periods }, { data: categories }] = await Promise.all([
    supabase.from('pricing_periods')
      .select('id, season_year, name, start_date, end_date, created_at')
      .order('season_year', { ascending: false })
      .order('start_date'),
    supabase.from('categories')
      .select('id, code, name_el, name_en, min_driver_age, min_licence_years, sort_order')
      .order('sort_order'),
  ])

  const allPeriods = (periods ?? []) as PeriodRow[]
  const cats = (categories ?? []) as CategoryRow[]

  if (cats.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="ir-notice border-warn bg-warn-tint text-warn">{t('noCategories')}</p>
      </div>
    )
  }

  const periodIds = allPeriods.map((p) => p.id)
  const [{ data: rows }, { data: extras }] = periodIds.length > 0
    ? await Promise.all([
        supabase.from('price_rows').select('period_id, category_id, days, total').in('period_id', periodIds),
        supabase.from('price_extra_day').select('period_id, category_id, price').in('period_id', periodIds),
      ])
    : [{ data: [] }, { data: [] }]

  const rowsByPeriod = new Map<string, PriceRowData[]>()
  for (const r of (rows ?? []) as (PriceRowData & { period_id: string })[]) {
    rowsByPeriod.set(r.period_id, [...(rowsByPeriod.get(r.period_id) ?? []), r])
  }
  const extraByPeriod = new Map<string, ExtraDayData[]>()
  for (const e of (extras ?? []) as (ExtraDayData & { period_id: string })[]) {
    extraByPeriod.set(e.period_id, [...(extraByPeriod.get(e.period_id) ?? []), e])
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>

      <Disclosure summary={`+ ${t('addPeriod')}`}>
        <PeriodForm />
      </Disclosure>

      {allPeriods.length === 0 ? (
        <p className="text-ink-soft">{t('noPeriods')}</p>
      ) : allPeriods.map((period) => {
        const periodRows = rowsByPeriod.get(period.id) ?? []
        const periodExtras = extraByPeriod.get(period.id) ?? []
        const rowsByCategory = (categoryId: string) => periodRows.filter((r) => r.category_id === categoryId)
        const extraFor = (categoryId: string) => periodExtras.find((e) => e.category_id === categoryId)

        return (
          <section key={period.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[1.25rem] font-semibold">
                {period.name} <span className="font-normal text-ink-soft">{period.season_year}</span>
              </h2>
              <p className="text-[0.875rem] text-ink-soft">{period.start_date} → {period.end_date}</p>
            </div>

            <Disclosure summary={t('editPeriod')}>
              <PeriodForm period={period} />
            </Disclosure>

            <Disclosure summary={t('bulkPaste')}>
              <BulkPasteForm periodId={period.id} />
            </Disclosure>

            <div className="grid gap-3">
              {cats.map((category) => (
                <PriceGridRow
                  key={category.id}
                  periodId={period.id}
                  category={category}
                  rows={rowsByCategory(category.id)}
                  extra={extraFor(category.id)}
                />
              ))}
            </div>

            <PricePreview categories={cats} />
          </section>
        )
      })}
    </div>
  )
}
