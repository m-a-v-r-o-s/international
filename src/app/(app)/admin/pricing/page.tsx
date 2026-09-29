import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { Disclosure } from '@/components/Disclosure'
import { AdjustPricesForm, DeletePeriodForm, PeriodForm, PeriodRanges } from './PeriodForm'
import { PriceGridRow, PricePreview, type ExtraDayData, type PriceRowData } from './PriceGrid'
import { todayAthens } from '@/lib/dates'
import type { CategoryRow, Database } from '@/lib/supabase/database.types'

type PeriodRow = Database['public']['Tables']['pricing_periods']['Row']
type RangeRow = Database['public']['Tables']['pricing_period_ranges']['Row']

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
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { sheet } = await searchParams
  await requireAdmin()
  const t = await getTranslations('admin.pricing')
  const supabase = await supabaseServer()

  const [{ data: periods }, { data: categories }] = await Promise.all([
    supabase.from('pricing_periods')
      .select('id, season_year, name, created_at')
      .order('season_year', { ascending: false })
      .order('name'),
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
  const [{ data: rows }, { data: extras }, { data: ranges }] = periodIds.length > 0
    ? await Promise.all([
        supabase.from('price_rows').select('period_id, category_id, days, total').in('period_id', periodIds),
        supabase.from('price_extra_day').select('period_id, category_id, price').in('period_id', periodIds),
        supabase.from('pricing_period_ranges').select('id, period_id, start_date, end_date, created_at')
          .in('period_id', periodIds).order('start_date'),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]

  const rangesByPeriod = new Map<string, RangeRow[]>()
  for (const r of (ranges ?? []) as RangeRow[]) {
    rangesByPeriod.set(r.period_id, [...(rangesByPeriod.get(r.period_id) ?? []), r])
  }

  const rowsByPeriod = new Map<string, PriceRowData[]>()
  for (const r of (rows ?? []) as (PriceRowData & { period_id: string })[]) {
    rowsByPeriod.set(r.period_id, [...(rowsByPeriod.get(r.period_id) ?? []), r])
  }
  const extraByPeriod = new Map<string, ExtraDayData[]>()
  for (const e of (extras ?? []) as (ExtraDayData & { period_id: string })[]) {
    extraByPeriod.set(e.period_id, [...(extraByPeriod.get(e.period_id) ?? []), e])
  }

  // The sheet pricing today's pickups. The ranges' exclusion constraint makes
  // it at most one, the same one quote() would pick.
  const today = todayAthens()
  const activeId = (ranges ?? []).find((r) => r.start_date <= today && today <= r.end_date)?.period_id
  const selected = allPeriods.find((p) => p.id === sheet)
    ?? allPeriods.find((p) => p.id === activeId)
    ?? allPeriods[0]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>

      <Disclosure summary={`+ ${t('addPeriod')}`}>
        <PeriodForm />
      </Disclosure>

      {allPeriods.length > 1 ? (
        <nav aria-label={t('title')}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {allPeriods.map((period) => {
              const periodRanges = rangesByPeriod.get(period.id) ?? []
              const isSelected = period.id === selected?.id
              return (
                <li key={period.id}>
                  <Link
                    href={`/admin/pricing?sheet=${period.id}`}
                    aria-current={isSelected ? 'page' : undefined}
                    className={`ir-card flex h-full min-h-11 flex-col gap-1 p-3 ${
                      isSelected ? 'border-2 border-brand' : 'hover:border-ink-soft'
                    }`}
                  >
                    <span className="font-semibold text-ink">
                      {period.name} <span className="font-normal text-ink-soft">{period.season_year}</span>
                    </span>
                    {period.id === activeId ? (
                      <span className="self-start rounded-full bg-ok px-2 py-0.5 text-[0.8125rem] font-bold text-white">
                        {t('activeNow')}
                      </span>
                    ) : periodRanges.length === 0 ? (
                      <span className="self-start rounded-full bg-warn-tint px-2 py-0.5 text-[0.8125rem] font-medium text-warn">
                        {t('draft')}
                      </span>
                    ) : null}
                    {periodRanges.map((r) => (
                      <span key={r.id} className="text-[0.8125rem] text-ink-soft">{r.start_date} → {r.end_date}</span>
                    ))}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      ) : null}

      {!selected ? (
        <p className="text-ink-soft">{t('noPeriods')}</p>
      ) : [selected].map((period) => {
        const periodRows = rowsByPeriod.get(period.id) ?? []
        const periodExtras = extraByPeriod.get(period.id) ?? []
        const rowsByCategory = (categoryId: string) => periodRows.filter((r) => r.category_id === categoryId)
        const extraFor = (categoryId: string) => periodExtras.find((e) => e.category_id === categoryId)

        return (
          <section key={period.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex flex-wrap items-baseline gap-2 text-[1.25rem] font-semibold">
                {period.name} <span className="font-normal text-ink-soft">{period.season_year}</span>
                {period.id === activeId ? (
                  <span className="self-center rounded-full bg-ok px-2 py-0.5 text-[0.8125rem] font-bold text-white">
                    {t('activeNow')}
                  </span>
                ) : null}
              </h2>
              <DeletePeriodForm periodId={period.id} />
            </div>

            <PeriodRanges periodId={period.id} ranges={rangesByPeriod.get(period.id) ?? []} />

            <Disclosure summary={t('editPeriod')}>
              <PeriodForm period={period} />
            </Disclosure>

            <Disclosure summary={t('adjust')}>
              <AdjustPricesForm periodId={period.id} />
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
