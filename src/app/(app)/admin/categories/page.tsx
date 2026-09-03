import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { Disclosure } from '@/components/Disclosure'
import { CategoryForm } from './CategoryForm'
import type { CategoryRow } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.categories')
  return { title: t('title') }
}

/**
 * A3's GROUPS half, back on its own screen — it lived inline in A10 Settings
 * for a while (see the note at the top of settings/page.tsx), which is why
 * settings/CategoriesSection.tsx still exists in history; the boss found that
 * page too long to scan, so Settings now links here instead of embedding it.
 *
 * The models that sit in these groups are NOT here: they live on the fleet
 * screen, beside the plates that belong to them (admin/fleet/ModelForm.tsx).
 * A group is a pricing and eligibility band — what a category costs, how old
 * its driver must be — which the boss sets once a season. A model is a car in
 * the yard.
 */
export default async function CategoriesPage() {
  await requireAdmin()
  const t = await getTranslations('admin.categories')
  const ts = await getTranslations('adminSettings')
  const supabase = await supabaseServer()

  const { data: categories } = await supabase.from('categories')
    .select('id, code, name_el, name_en, min_driver_age, min_licence_years, sort_order')
    .order('sort_order')

  const cats = (categories ?? []) as CategoryRow[]

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/settings" className="text-[0.9375rem] text-brand underline-offset-2 hover:underline">
        ← {ts('title')}
      </Link>

      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('intro')}</p>
      </div>

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
          </section>
        ))}
      </div>
    </div>
  )
}
