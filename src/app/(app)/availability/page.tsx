import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { loadCarsWithSpecs, loadAvailability } from '@/lib/availability/load'
import { isFreeForRange } from '@/lib/availability/types'
import { FilterForm } from './FilterForm'
import type { CategoryRow } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('availability')
  return { title: t('title') }
}

function defaultRange(): { from: string; to: string } {
  const from = new Date()
  const to = new Date(from)
  to.setDate(to.getDate() + 6)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { from: fmt(from), to: fmt(to) }
}

/**
 * R2 · Availability — the core lookup (docs/04-SCREENS.md). Occupied is a flat
 * neutral block with no label: whatever occupied a date — another rep's
 * booking or an admin block — is drawn identically, because availability()
 * hands back nothing that could tell them apart (docs/01-DECISIONS.md §8).
 */
export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireUnlocked()
  const t = await getTranslations('availability')
  const params = await searchParams
  const supabase = await supabaseServer()

  const defaults = defaultRange()
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? '') ? params.from! : defaults.from
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.to ?? '') ? params.to! : defaults.to
  const validRange = to >= from

  const { data: categories } = await supabase.from('categories')
    .select('id, code, name_el, name_en, min_driver_age, min_licence_years, sort_order')
    .order('sort_order')
  const cats = (categories ?? []) as CategoryRow[]

  const [cars, occupied] = validRange
    ? await Promise.all([loadCarsWithSpecs(supabase), loadAvailability(supabase, from, to)])
    : [[], new Map<string, string[]>()]

  let filtered = cars
  if (params.category) filtered = filtered.filter((c) => c.category_id === params.category)
  if (params.transmission) filtered = filtered.filter((c) => c.transmission === params.transmission)
  if (params.seats) filtered = filtered.filter((c) => c.seats >= Number(params.seats))
  if (params.aircon === '1') filtered = filtered.filter((c) => c.aircon)

  const byCategory = new Map<string, typeof filtered>()
  for (const car of filtered) {
    byCategory.set(car.category_id, [...(byCategory.get(car.category_id) ?? []), car])
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>

      <FilterForm categories={cats} from={from} to={to} searchParams={params} />

      {!validRange ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{t('invalidRange')}</p>
      ) : filtered.length === 0 ? (
        <p className="text-ink-soft">{t('noneMatch')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {cats.filter((c) => byCategory.has(c.id)).map((category) => (
            <section key={category.id} aria-labelledby={`cat-${category.id}`}>
              <h2 id={`cat-${category.id}`} className="mb-2 text-[1.0625rem] font-semibold">
                {category.code} — {category.name_en}
              </h2>
              <ul className="flex flex-col gap-2">
                {byCategory.get(category.id)!.map((car) => {
                  const occupiedDates = occupied.get(car.id) ?? []
                  const free = isFreeForRange(occupiedDates, from, to)
                  return (
                    <li key={car.id} className="ir-card flex items-center justify-between gap-3 p-3.5">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{car.make} {car.model}</p>
                        <p className="truncate text-[0.8125rem] text-ink-soft">
                          {car.plate} · {t(`transmission.${car.transmission}`)} · {t('seatsCount', { n: car.seats })}
                          {car.aircon ? ` · ${t('aircon')}` : ''}
                        </p>
                      </div>
                      {free ? (
                        <Link
                          href={`/bookings/new?car=${car.id}&from=${from}&to=${to}`}
                          className="ir-btn-primary !w-auto shrink-0"
                        >
                          {t('bookThisCar')}
                        </Link>
                      ) : (
                        <span
                          className="shrink-0 rounded-field bg-canvas px-3 py-2 text-[0.875rem] font-medium text-ink-soft"
                          aria-label={t('occupiedLabel')}
                        >
                          {t('occupied')}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
