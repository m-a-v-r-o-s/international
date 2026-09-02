import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { todayAthens } from '@/lib/dates'
import { Disclosure } from '@/components/Disclosure'
import { CarForm } from './CarForm'
import type { BookingRow, CarModelRow, CarRow, CategoryRow } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.fleet')
  return { title: t('title') }
}

type BoardStatus = 'out' | 'free' | 'blocked' | 'backToday'

/**
 * A2 + A3 · Fleet (docs/04-SCREENS.md). The board and car management were two
 * screens listing the same ~100 plates — one for today's status, one to edit
 * the records — so they are now one, and one list: cars grouped by model, each
 * plate carrying today's status. The counts and the two filters sit above it.
 *
 * Status per car: `out` (a rental is currently out), `blocked` (an admin block
 * covers today), `backToday` (a rental returns today — still `out` right now,
 * but the boss cares that it is due), or `free`. Unlike availability()
 * (rep-facing, dates only) the admin can query `bookings` directly, so today's
 * actual status and the car it belongs to come from one query rather than a
 * date-range engine built for a different question.
 */
export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAdmin()
  const t = await getTranslations('admin.fleet')
  const params = await searchParams
  const categoryFilter = params.category ?? ''
  const statusFilter = params.status ?? ''
  const supabase = await supabaseServer()
  const today = todayAthens()

  const [{ data: cars }, { data: models }, { data: categories }, { data: todaysHolds }] = await Promise.all([
    supabase.from('cars')
      .select('id, plate, model_id, year, colour, photo_path, archived_at, created_at, updated_at')
      .order('plate'),
    supabase.from('car_models')
      .select('id, make, model, category_id, transmission, fuel_type, seats, doors, tank_litres, photo_path')
      .order('make'),
    supabase.from('categories').select('id, code, name_el, name_en, min_driver_age, min_licence_years, sort_order')
      .order('sort_order'),
    supabase.from('bookings')
      .select('id, car_id, kind, status, start_date, end_date, cust_first, cust_last')
      .in('status', ['booked', 'out', 'blocked'])
      .lte('start_date', today).gte('end_date', today),
  ])

  const allCars = (cars ?? []) as CarRow[]
  const allModels = (models ?? []) as CarModelRow[]
  const allCategories = (categories ?? []) as CategoryRow[]
  const modelById = new Map(allModels.map((m) => [m.id, m]))
  const catById = new Map(allCategories.map((c) => [c.id, c]))

  type Hold = Pick<BookingRow, 'id' | 'car_id' | 'kind' | 'status' | 'start_date' | 'end_date' | 'cust_first' | 'cust_last'>
  const holdByCarId = new Map<string, Hold>()
  for (const h of (todaysHolds ?? []) as Hold[]) holdByCarId.set(h.car_id, h)

  // Archived cars are out of the fleet, so they carry no status and are not
  // counted or filtered — they stay in their own collapsed list at the foot.
  const active = allCars.filter((c) => !c.archived_at)
  const archived = allCars.filter((c) => c.archived_at)

  const board = active.map((car) => {
    const model = modelById.get(car.model_id)
    const category = model ? catById.get(model.category_id) : undefined
    const hold = holdByCarId.get(car.id)

    let status: BoardStatus = 'free'
    if (hold?.kind === 'block') status = 'blocked'
    else if (hold?.status === 'out' && hold.end_date === today) status = 'backToday'
    else if (hold?.status === 'out' || hold?.status === 'booked') status = 'out'

    return { car, model, category, hold, status }
  })

  // Counted over the whole fleet, not the filtered view: the summary line is
  // the state of the yard, and a filter is only a way of reading it.
  const counts: Record<BoardStatus, number> = { out: 0, free: 0, blocked: 0, backToday: 0 }
  for (const row of board) counts[row.status]++

  const filtered = board.filter((row) => {
    if (categoryFilter && row.category?.id !== categoryFilter) return false
    if (statusFilter && row.status !== statusFilter) return false
    return true
  })

  // Grouped in plate order of each model's first car, which is the order the
  // `cars` query already came back in.
  const byModel = new Map<string, typeof filtered>()
  for (const row of filtered) {
    byModel.set(row.car.model_id, [...(byModel.get(row.car.model_id) ?? []), row])
  }

  const statusStyle: Record<BoardStatus, string> = {
    free: 'bg-ok-tint text-ok',
    out: 'bg-brand-tint text-brand',
    blocked: 'bg-canvas text-ink-soft border border-line-strong',
    backToday: 'bg-warn-tint text-warn',
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
        <div>
          <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
          <p className="text-[0.9375rem] text-ink-soft">
            {t('summary', { free: counts.free, out: counts.out, blocked: counts.blocked, backToday: counts.backToday })}
          </p>
        </div>
        <p className="text-[0.9375rem] text-ink-soft">{t('count', { n: active.length })}</p>
      </div>

      <form className="flex flex-wrap items-end gap-3">
        <div>
          <label className="ir-label" htmlFor="category">{t('filterCategory')}</label>
          <select id="category" name="category" className="ir-field" defaultValue={categoryFilter}>
            <option value="">{t('anyCategory')}</option>
            {allCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.code}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="ir-label" htmlFor="status">{t('filterStatus')}</label>
          <select id="status" name="status" className="ir-field" defaultValue={statusFilter}>
            <option value="">{t('anyStatus')}</option>
            <option value="free">{t('status.free')}</option>
            <option value="out">{t('status.out')}</option>
            <option value="backToday">{t('status.backToday')}</option>
            <option value="blocked">{t('status.blocked')}</option>
          </select>
        </div>
        <button type="submit" className="ir-btn-quiet !w-auto">{t('apply')}</button>
      </form>

      <Disclosure summary={`+ ${t('add')}`}>
        <CarForm models={allModels} />
      </Disclosure>

      {filtered.length === 0 ? (
        <p className="text-ink-soft">{t('noneMatch')}</p>
      ) : (
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
                  {group.map(({ car, hold, status }) => (
                    <li key={car.id} className="flex items-center justify-between gap-3 py-2.5">
                      <Link
                        href={`/admin/fleet/${car.id}`}
                        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center py-1 underline-offset-2 hover:underline"
                      >
                        <span className="text-[1.0625rem] font-medium text-brand">{car.plate}</span>
                        <span className="truncate text-[0.875rem] text-ink-soft">
                          {[
                            car.year,
                            car.colour,
                            status === 'out' || status === 'backToday'
                              ? `${hold?.cust_first ?? ''} ${hold?.cust_last ?? ''}`.trim()
                              : '',
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </Link>
                      <span className={`shrink-0 rounded-field px-3 py-1 text-[0.8125rem] font-medium ${statusStyle[status]}`}>
                        {t(`status.${status}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {archived.length > 0 ? (
        <Disclosure summary={t('archived', { n: archived.length })}>
          <ul className="flex flex-col divide-y divide-line">
            {archived.map((car) => {
              const model = modelById.get(car.model_id)
              return (
                <li key={car.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link
                    href={`/admin/fleet/${car.id}`}
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
