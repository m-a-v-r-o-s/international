import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { getLocale } from '@/i18n/locale'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { loadCarsWithSpecs, loadAvailability } from '@/lib/availability/load'
import { groupFleet, type ModelAvailability } from '@/lib/availability/types'
import { modelPhotoUrl } from '@/lib/storage/fleet-photos'
import { categoryName } from '@/lib/fleet/categories'
import { Disclosure } from '@/components/Disclosure'
import { DateRange } from './DateRange'
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
 * R2 · Availability — the core lookup (docs/04-SCREENS.md).
 *
 * A visual list of car MODELS, grouped under their group heading, each card
 * carrying the model's photo and how many of its plates are free for the whole
 * range. A model with nothing free greys out and keeps its place, so the rep
 * can say "no Pandas, but I have a Yaris" without scrolling back up.
 *
 * Cards run left to right, two to a line on a phone, wrapping rather than
 * scrolling sideways: with eight groups a shelf would mean eight separate
 * swipes, and a model off the right-hand edge is a model the rep does not know
 * they have.
 *
 * Occupied stays a flat neutral fact with no label: whatever occupied a date —
 * another rep's booking or an admin block — is drawn identically, because
 * availability() hands back nothing that could tell them apart
 * (docs/01-DECISIONS.md §8). A count of free plates is the same fact, added up.
 */
export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireUnlocked()
  const t = await getTranslations('availability')
  const locale = await getLocale()
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

  const grouped = groupFleet(cars, occupied, from, to)
  const byCategory = new Map(grouped.map((g) => [g.categoryId, g]))

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>

      <DateRange from={from} to={to} />

      {!validRange ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{t('invalidRange')}</p>
      ) : grouped.length === 0 ? (
        <p className="text-ink-soft">{t('empty')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {cats.filter((c) => byCategory.has(c.id)).map((category) => {
            const group = byCategory.get(category.id)!
            return (
              <section key={category.id} aria-labelledby={`cat-${category.id}`}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h2 id={`cat-${category.id}`} className="text-[1.0625rem] font-semibold">
                    {category.code} — {categoryName(category, locale)}
                  </h2>
                  <p className="text-[0.875rem] tabular-nums text-ink-soft">
                    {t('groupTally', { free: group.free, total: group.total })}
                  </p>
                </div>

                {/* Two to a line on a phone, three once there is room. The
                    cards are one object repeated, so every card in a line
                    shares its edges and its inner rhythm however many there
                    are — a group of three simply leaves the last slot empty. */}
                <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {group.models.map((model) => (
                    <ModelCard
                      key={model.modelId}
                      model={model}
                      photoUrl={modelPhotoUrl(supabase, model.photoPath)}
                      categoryCode={category.code}
                      from={from}
                      to={to}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * One model.
 *
 * The count is stated three ways on purpose, and none of them is decoration.
 * The pip bar is read before it is counted — "nearly gone" lands as a shape.
 * The words under it are the number the rep says out loud. And the greying of
 * a sold-out card is never the only signal: it also carries "None free" in
 * text, because colour alone fails WCAG 1.4.1 and fails a rep in Cretan
 * sunlight for the same practical reason.
 */
async function ModelCard({
  model, photoUrl, categoryCode, from, to,
}: {
  model: ModelAvailability
  photoUrl: string | null
  categoryCode: string
  from: string
  to: string
}) {
  const t = await getTranslations('availability')
  const soldOut = model.free === 0
  const name = `${model.make} ${model.model}`

  return (
    <li
      className={`ir-card flex flex-col gap-2 p-2.5 ${soldOut ? 'bg-canvas' : ''}`}
      aria-labelledby={`model-${model.modelId}`}
    >
      {/* Fixed 4:3 whether or not a photo exists, so a group of cards keeps one
          baseline. The fallback is the group letter rather than a broken-image
          icon or a grey void — it is the thing the rep would have read off the
          heading anyway. */}
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={t('photoAlt', { make: model.make, model: model.model })}
          className={`aspect-[4/3] w-full rounded-field border border-line object-cover
                      ${soldOut ? 'opacity-60 grayscale' : ''}`}
        />
      ) : (
        <div
          className={`flex aspect-[4/3] w-full flex-col items-center justify-center rounded-field
                      border border-line ${soldOut ? 'bg-canvas' : 'bg-brand-tint'}`}
          aria-hidden="true"
        >
          <span className={`text-[1.75rem] font-bold leading-none ${soldOut ? 'text-ink-soft' : 'text-brand'}`}>
            {categoryCode}
          </span>
        </div>
      )}

      <div className="min-w-0">
        <p id={`model-${model.modelId}`} className="truncate text-[0.9375rem] font-semibold">{name}</p>
        <p className="truncate text-[0.8125rem] text-ink-soft">
          {t(`transmission.${model.transmission}`)} · {t('seatsCount', { n: model.seats })}
        </p>
      </div>

      {/* One pip per plate. Labelled as a whole rather than pip by pip, so a
          screen reader reads the fact and not six list items. */}
      <div
        className="flex gap-0.5"
        role="img"
        aria-label={t('pipsLabel', { free: model.free, total: model.total })}
      >
        {model.plates.map((plate) => (
          <span
            key={plate.id}
            className={`h-1.5 flex-1 rounded-sm ${plate.free ? 'bg-ok' : 'bg-line-strong'}`}
          />
        ))}
      </div>

      <p className={`text-[0.8125rem] font-medium tabular-nums ${soldOut ? 'text-ink-soft' : 'text-ok'}`}>
        {soldOut ? t('allOut', { total: model.total }) : t('modelTally', { free: model.free, total: model.total })}
      </p>

      {/* A booking holds one plate, so `Book` has to name one. The first free
          plate is it: which of six identical Pandas a guest gets is not a
          decision anyone makes at this point in the conversation — and the rep
          who does care opens the plates below and picks. */}
      {model.firstFreeCarId ? (
        <Link
          href={`/bookings/new?car=${model.firstFreeCarId}&from=${from}&to=${to}`}
          className="ir-btn-primary !min-h-11 !px-3 !text-[0.9375rem]"
        >
          {t('book')}
        </Link>
      ) : (
        <span className="flex min-h-11 items-center justify-center rounded-field border border-line-strong
                         bg-surface px-3 text-[0.9375rem] font-medium text-ink-soft">
          {t('noneFree')}
        </span>
      )}

      <Disclosure summary={<span className="text-[0.8125rem] font-medium text-brand">{t('plates')}</span>}>
        <ul className="flex flex-col divide-y divide-line" aria-label={t('platesLabel', { name })}>
          {model.plates.map((plate) => (
            <li key={plate.id} className="flex items-center justify-between gap-2 py-2">
              <span className="truncate text-[0.875rem]">{plate.plate}</span>
              {plate.free ? (
                <Link
                  href={`/bookings/new?car=${plate.id}&from=${from}&to=${to}`}
                  className="shrink-0 text-[0.8125rem] font-semibold text-brand underline underline-offset-2"
                >
                  {t('free')}
                </Link>
              ) : (
                <span className="shrink-0 text-[0.8125rem] text-ink-soft" aria-label={t('occupiedLabel')}>
                  {t('occupied')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Disclosure>
    </li>
  )
}
