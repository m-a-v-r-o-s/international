import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { Disclosure } from '@/components/Disclosure'
import { CarForm } from './CarForm'
import type { CarModelRow, CarRow, CategoryRow } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.cars')
  return { title: t('title') }
}

/**
 * A3 · Car management. The fleet has to exist before anything downstream —
 * availability, bookings, the movements sheet — is demonstrable, so this is
 * the first screen built (HANDOFF.md). Cars are grouped by model so a hundred
 * plates read as ~20 groups, not a wall of rows.
 */
export default async function CarsPage() {
  await requireAdmin()
  const t = await getTranslations('admin.cars')
  const supabase = await supabaseServer()

  const [{ data: cars }, { data: models }, { data: categories }] = await Promise.all([
    supabase.from('cars')
      .select('id, plate, model_id, year, colour, photo_path, archived_at, created_at, updated_at')
      .order('plate'),
    supabase.from('car_models')
      .select('id, make, model, category_id, transmission, fuel_type, seats, doors, aircon, tank_litres, photo_path')
      .order('make'),
    supabase.from('categories').select('id, code, name_el, name_en, min_driver_age, min_licence_years, sort_order'),
  ])

  const allCars = (cars ?? []) as CarRow[]
  const allModels = (models ?? []) as CarModelRow[]
  const catById = new Map(((categories ?? []) as CategoryRow[]).map((c) => [c.id, c]))
  const modelById = new Map(allModels.map((m) => [m.id, m]))

  const active = allCars.filter((c) => !c.archived_at)
  const archived = allCars.filter((c) => c.archived_at)

  const byModel = new Map<string, CarRow[]>()
  for (const car of active) {
    byModel.set(car.model_id, [...(byModel.get(car.model_id) ?? []), car])
  }

  if (allModels.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="ir-notice border-warn bg-warn-tint text-warn">{t('noModels')}</p>
        <Link href="/admin/categories" className="ir-btn-primary">{t('goToCategories')}</Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-[0.9375rem] text-ink-soft">{t('count', { n: active.length })}</p>
      </div>

      <Disclosure summary={`+ ${t('add')}`}>
        <CarForm models={allModels} />
      </Disclosure>

      <div className="flex flex-col gap-4">
        {[...byModel.entries()].map(([modelId, group]) => {
          const model = modelById.get(modelId)
          const category = model ? catById.get(model.category_id) : undefined
          return (
            <section key={modelId} className="ir-card p-4">
              <h2 className="text-[1.0625rem] font-semibold">
                {model ? `${model.make} ${model.model}` : t('unknownModel')}
                {category ? <span className="ml-2 text-[0.875rem] font-normal text-ink-soft">{category.code}</span> : null}
              </h2>
              <ul className="mt-3 flex flex-col divide-y divide-line">
                {group.map((car) => (
                  <li key={car.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link
                      href={`/admin/cars/${car.id}`}
                      className="min-h-11 flex-1 py-1 text-[1.0625rem] font-medium text-brand underline-offset-2 hover:underline"
                    >
                      {car.plate}
                    </Link>
                    <span className="text-[0.875rem] text-ink-soft">
                      {[car.year, car.colour].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {archived.length > 0 ? (
        <Disclosure summary={t('archived', { n: archived.length })}>
          <ul className="flex flex-col divide-y divide-line">
            {archived.map((car) => {
              const model = modelById.get(car.model_id)
              return (
                <li key={car.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link
                    href={`/admin/cars/${car.id}`}
                    className="min-h-11 flex-1 py-1 text-[1.0625rem] text-ink-soft underline-offset-2 hover:underline"
                  >
                    {car.plate} — {model ? `${model.make} ${model.model}` : t('unknownModel')}
                  </Link>
                </li>
              )
            })}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  )
}
