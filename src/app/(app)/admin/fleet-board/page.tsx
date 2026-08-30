import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import type { BookingRow, CarModelRow, CarRow, CategoryRow } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.fleetBoard')
  return { title: t('title') }
}

type BoardStatus = 'out' | 'free' | 'blocked' | 'backToday'

/**
 * A2 · Fleet board (docs/04-SCREENS.md). All ~100 cars, live, with one status
 * each: `out` (a rental is currently out), `blocked` (an admin block covers
 * today), `backToday` (a rental returns today — still `out` right now, but the
 * boss cares that it is due), or `free`. Unlike availability() (rep-facing,
 * dates only) the admin can query `bookings` directly, so today's actual
 * status and the car it belongs to come from one query rather than a
 * date-range engine built for a different question.
 */
export default async function FleetBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAdmin()
  const t = await getTranslations('admin.fleetBoard')
  const params = await searchParams
  const categoryFilter = params.category ?? ''
  const statusFilter = params.status ?? ''
  const supabase = await supabaseServer()
  const today = todayAthens()

  const [{ data: cars }, { data: models }, { data: categories }, { data: todaysHolds }] = await Promise.all([
    supabase.from('cars')
      .select('id, plate, model_id, year, colour, photo_path, archived_at, created_at, updated_at')
      .is('archived_at', null)
      .order('plate'),
    supabase.from('car_models')
      .select('id, make, model, category_id, transmission, fuel_type, seats, doors, aircon, tank_litres, photo_path'),
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

  const board = allCars.map((car) => {
    const model = modelById.get(car.model_id)
    const category = model ? catById.get(model.category_id) : undefined
    const hold = holdByCarId.get(car.id)

    let status: BoardStatus = 'free'
    if (hold?.kind === 'block') status = 'blocked'
    else if (hold?.status === 'out' && hold.end_date === today) status = 'backToday'
    else if (hold?.status === 'out' || hold?.status === 'booked') status = 'out'

    return { car, model, category, hold, status }
  })

  const filtered = board.filter((row) => {
    if (categoryFilter && row.category?.id !== categoryFilter) return false
    if (statusFilter && row.status !== statusFilter) return false
    return true
  })

  const counts: Record<BoardStatus, number> = { out: 0, free: 0, blocked: 0, backToday: 0 }
  for (const row of board) counts[row.status]++

  const statusStyle: Record<BoardStatus, string> = {
    free: 'bg-ok-tint text-ok',
    out: 'bg-brand-tint text-brand',
    blocked: 'bg-canvas text-ink-soft border border-line-strong',
    backToday: 'bg-warn-tint text-warn',
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-[0.9375rem] text-ink-soft">
          {t('summary', { free: counts.free, out: counts.out, blocked: counts.blocked, backToday: counts.backToday })}
        </p>
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

      {filtered.length === 0 ? (
        <p className="text-ink-soft">{t('noneMatch')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map(({ car, model, category, hold, status }) => (
            <li key={car.id}>
              <Link
                href={`/admin/cars/${car.id}`}
                className="ir-card flex items-center justify-between gap-3 p-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {car.plate}
                    {category ? <span className="ml-2 text-[0.8125rem] font-normal text-ink-soft">{category.code}</span> : null}
                  </p>
                  <p className="truncate text-[0.8125rem] text-ink-soft">
                    {model ? `${model.make} ${model.model}` : t('unknownModel')}
                    {status === 'out' || status === 'backToday'
                      ? ` · ${hold?.cust_first ?? ''} ${hold?.cust_last ?? ''}`.trim()
                      : ''}
                  </p>
                </div>
                <span className={`shrink-0 rounded-field px-3 py-1 text-[0.8125rem] font-medium ${statusStyle[status]}`}>
                  {t(`status.${status}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function todayAthens(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' })
}
