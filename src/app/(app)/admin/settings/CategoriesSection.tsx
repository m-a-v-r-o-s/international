import { getTranslations } from 'next-intl/server'
import { supabaseServer } from '@/lib/supabase/server'
import { Disclosure } from '@/components/Disclosure'
import { CategoryForm } from '../categories/CategoryForm'
import type { CategoryRow } from '@/lib/supabase/database.types'

/**
 * A3's GROUPS half, folded into A10 Settings the same way the hotels half was
 * (see the note at the top of page.tsx). It used to be its own sidebar entry
 * at /admin/categories, which now only redirects here.
 *
 * The models that sit in these groups are NOT here: they moved to the fleet
 * screen, beside the plates that belong to them
 * (admin/fleet/ModelForm.tsx). The split is the difference between the two
 * things. A group is a pricing and eligibility band — what a category costs,
 * how old its driver must be — which the boss sets once a season and which
 * belongs with the rest of the settings. A model is a car in the yard.
 *
 * The 8 groups themselves. The client's real names have not arrived
 * (docs/01-DECISIONS.md §28.1-2); this section is exactly where the boss will
 * type them in once they do, so it has to exist ahead of the fleet, not after.
 */
export async function CategoriesSection() {
  const t = await getTranslations('admin.categories')
  const supabase = await supabaseServer()

  const { data: categories } = await supabase.from('categories')
    .select('id, code, name_el, name_en, min_driver_age, min_licence_years, sort_order')
    .order('sort_order')

  const cats = (categories ?? []) as CategoryRow[]

  return (
    <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="categories-heading">
      <h2 id="categories-heading" className="text-[1.0625rem] font-semibold">{t('title')}</h2>

      <Disclosure summary={`+ ${t('add')}`}>
        <CategoryForm />
      </Disclosure>

      <div className="flex flex-col gap-4">
        {cats.length === 0 ? (
          <p className="text-ink-soft">{t('empty')}</p>
        ) : cats.map((category) => (
          <section key={category.id} className="ir-card p-4" aria-labelledby={`cat-${category.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`cat-${category.id}`} className="text-[1.125rem] font-semibold">
                {category.code} — {category.name_en} / {category.name_el}
              </h3>
              <p className="text-[0.875rem] text-ink-soft">
                {t('ageAndLicence', { age: category.min_driver_age, years: category.min_licence_years })}
              </p>
            </div>

            <Disclosure summary={t('edit')}>
              <CategoryForm category={category} />
            </Disclosure>
          </section>
        ))}
      </div>
    </section>
  )
}
