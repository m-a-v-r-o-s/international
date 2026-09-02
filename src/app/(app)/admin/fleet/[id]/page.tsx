import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { Disclosure } from '@/components/Disclosure'
import { CarForm } from '../CarForm'
import { BlockForm, type BlockRow } from '../BlockForm'
import { ArchiveToggle, DeleteCarForm, NotesForm } from '../CarActions'
import type { CarModelRow, CarRow, CategoryRow } from '@/lib/supabase/database.types'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const t = await getTranslations('admin.fleet')
  return { title: `${t('title')} — ${id}` }
}

/**
 * A3 · One car's record and its blocks. Blocks are fetched a year either side
 * of today so the admin sees recent history alongside anything scheduled
 * ahead, without the window growing unbounded as the fleet ages.
 */
export default async function CarDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const t = await getTranslations('admin.fleet')
  const tb = await getTranslations('admin.blocks')
  const supabase = await supabaseServer()

  const { data: car } = await supabase.from('cars')
    .select('id, plate, model_id, year, colour, photo_path, archived_at, created_at, updated_at')
    .eq('id', id).maybeSingle()

  if (!car) notFound()
  const carRow = car as CarRow

  const { data: models } = await supabase.from('car_models')
    .select('id, make, model, category_id, transmission, fuel_type, seats, doors, tank_litres, photo_path')
    .order('make')
  const allModels = (models ?? []) as CarModelRow[]
  const model = allModels.find((m) => m.id === carRow.model_id)

  const { data: category } = model
    ? await supabase.from('categories')
        .select('id, code, name_el, name_en, min_driver_age, min_licence_years, sort_order')
        .eq('id', model.category_id).maybeSingle()
    : { data: null }

  const today = new Date()
  const from = new Date(today); from.setFullYear(from.getFullYear() - 1)
  const to = new Date(today); to.setFullYear(to.getFullYear() + 1)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  const [{ data: notes }, { data: allBlocks }] = await Promise.all([
    supabase.rpc('admin_car_notes', { p_car_id: id }),
    supabase.rpc('admin_blocks', { p_from: fmt(from), p_to: fmt(to) }),
  ])
  const blocks = ((allBlocks ?? []) as BlockRow[]).filter((b) => b.car_id === id)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-bold tracking-tight">{carRow.plate}</h1>
          <p className="text-ink-soft">
            {model ? `${model.make} ${model.model}` : t('unknownModel')}
            {(category as CategoryRow | null) ? ` · ${(category as CategoryRow).code}` : ''}
          </p>
        </div>
        {carRow.archived_at ? (
          <span className="ir-notice border-line-strong bg-canvas text-ink-soft !py-1.5">{t('archivedBadge')}</span>
        ) : null}
      </div>
      <Link href="/admin/fleet" className="text-[0.9375rem] text-brand underline-offset-2 hover:underline">
        {t('backToFleet')}
      </Link>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.125rem] font-semibold">{t('details')}</h2>
        <CarForm car={carRow} models={allModels} />
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.125rem] font-semibold">{t('notesTitle')}</h2>
        <NotesForm id={carRow.id} notes={(notes as string | null) ?? null} />
      </section>

      <section className="ir-card p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-[1.125rem] font-semibold">{tb('title')}</h2>
        </div>
        <p className="mb-3 text-[0.875rem] text-ink-soft">{tb('screenHint')}</p>

        <div className="flex flex-col gap-2">
          {blocks.length === 0 ? (
            <p className="text-ink-soft">{tb('empty')}</p>
          ) : blocks.map((block) => (
            <Disclosure key={block.id} summary={`${block.start_date} → ${block.end_date}`}>
              <BlockForm carId={carRow.id} block={block} />
            </Disclosure>
          ))}
          <Disclosure summary={`+ ${tb('add')}`}>
            <BlockForm carId={carRow.id} />
          </Disclosure>
        </div>
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.125rem] font-semibold">{t('dangerZone')}</h2>
        <div className="flex flex-col gap-3">
          <ArchiveToggle id={carRow.id} archived={carRow.archived_at !== null} />
          <DeleteCarForm id={carRow.id} />
        </div>
      </section>
    </div>
  )
}
