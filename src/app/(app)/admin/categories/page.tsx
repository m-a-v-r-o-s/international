import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { Disclosure } from '@/components/Disclosure'
import { CategoryForm } from './CategoryForm'
import { ModelForm } from './ModelForm'
import type { CarModelRow, CategoryRow } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.categories')
  return { title: t('title') }
}

/**
 * A3 (categories & models half) — the 8 categories and the 20 models that sit
 * in them. The client's real names have not arrived (docs/01-DECISIONS.md
 * §28.1-2); this screen is exactly where the boss will type them in once they
 * do, so it has to exist ahead of the fleet, not after it.
 */
export default async function CategoriesPage() {
  await requireAdmin()
  const t = await getTranslations('admin.categories')
  const tm = await getTranslations('admin.models')
  const supabase = await supabaseServer()

  const [{ data: categories }, { data: models }] = await Promise.all([
    supabase.from('categories')
      .select('id, code, name_el, name_en, min_driver_age, min_licence_years, sort_order')
      .order('sort_order'),
    supabase.from('car_models')
      .select('id, make, model, category_id, transmission, fuel_type, seats, doors, tank_litres, photo_path')
      .order('make'),
  ])

  const cats = (categories ?? []) as CategoryRow[]
  const mods = (models ?? []) as CarModelRow[]
  const modelsByCategory = new Map<string, CarModelRow[]>()
  for (const m of mods) {
    modelsByCategory.set(m.category_id, [...(modelsByCategory.get(m.category_id) ?? []), m])
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>

      <Disclosure summary={`+ ${t('add')}`}>
        <CategoryForm />
      </Disclosure>

      <div className="flex flex-col gap-4">
        {cats.length === 0 ? (
          <p className="text-ink-soft">{t('empty')}</p>
        ) : cats.map((category) => (
          <section key={category.id} className="ir-card p-4" aria-labelledby={`cat-${category.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`cat-${category.id}`} className="text-[1.125rem] font-semibold">
                {category.code} — {category.name_en} / {category.name_el}
              </h2>
              <p className="text-[0.875rem] text-ink-soft">
                {t('ageAndLicence', { age: category.min_driver_age, years: category.min_licence_years })}
              </p>
            </div>

            <Disclosure summary={t('edit')}>
              <CategoryForm category={category} />
            </Disclosure>

            <div className="mt-4 flex flex-col gap-2">
              {(modelsByCategory.get(category.id) ?? []).map((model) => (
                <Disclosure
                  key={model.id}
                  summary={`${model.make} ${model.model} · ${model.seats} ${tm('seatsShort')} · ${
                    model.transmission === 'automatic' ? tm('automatic') : tm('manual')
                  }`}
                >
                  <ModelForm model={model} categories={cats} />
                </Disclosure>
              ))}
              <Disclosure summary={`+ ${tm('add')}`}>
                <ModelForm categories={cats} />
              </Disclosure>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
