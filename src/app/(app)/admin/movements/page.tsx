import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { PrintButton } from './PrintButton'
import type { BookingRow } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.movements')
  return { title: t('title') }
}

const COLUMNS =
  'id, ref, status, car_id, hotel_id, room_number, start_date, end_date, ' +
  'pickup_at, dropoff_at, cust_first, cust_last, created_by'

type Movement = Pick<BookingRow,
  'id' | 'ref' | 'status' | 'car_id' | 'hotel_id' | 'room_number' | 'start_date' | 'end_date'
  | 'pickup_at' | 'dropoff_at' | 'cust_first' | 'cust_last' | 'created_by'>

/**
 * A1 · Movements sheet (docs/04-SCREENS.md). The paper day-sheet, replaced:
 * every pickup and every return due on one day, across every hotel, in time
 * order. A pickup is a rental starting that day; a return is a rental ending
 * that day and not already closed (a rental extended past this date no longer
 * belongs on it — `end_date` moved). This is a read over data the rep screens
 * already expose to their own bookings; admin sees every hotel's because RLS's
 * `app.is_admin()` branch has no hotel restriction.
 */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAdmin()
  const t = await getTranslations('admin.movements')
  const params = await searchParams
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day ?? '') ? params.day! : todayAthens()
  const supabase = await supabaseServer()

  const [{ data: pickupRows }, { data: returnRows }] = await Promise.all([
    supabase.from('bookings').select(COLUMNS)
      .eq('kind', 'rental').eq('start_date', day)
      .in('status', ['booked', 'out']),
    supabase.from('bookings').select(COLUMNS)
      .eq('kind', 'rental').eq('end_date', day)
      .in('status', ['out', 'returned']),
  ])

  const pickups = (pickupRows ?? []) as unknown as Movement[]
  const returns = (returnRows ?? []) as unknown as Movement[]

  const carIds = [...new Set([...pickups, ...returns].map((b) => b.car_id))]
  const hotelIds = [...new Set([...pickups, ...returns].map((b) => b.hotel_id).filter((h): h is string => h !== null))]
  const repIds = [...new Set([...pickups, ...returns].map((b) => b.created_by))]

  const [{ data: cars }, { data: hotels }, { data: reps }] = await Promise.all([
    carIds.length > 0
      ? supabase.from('cars').select('id, plate, model_id').in('id', carIds)
      : Promise.resolve({ data: [] }),
    hotelIds.length > 0
      ? supabase.from('hotels').select('id, name').in('id', hotelIds)
      : Promise.resolve({ data: [] }),
    repIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', repIds)
      : Promise.resolve({ data: [] }),
  ])

  const modelIds = [...new Set((cars ?? []).map((c) => c.model_id))]
  const { data: models } = modelIds.length > 0
    ? await supabase.from('car_models').select('id, make, model').in('id', modelIds)
    : { data: [] }

  const plateById = new Map((cars ?? []).map((c) => [c.id, c.plate]))
  const modelByCarId = new Map((cars ?? []).map((c) => [c.id, (models ?? []).find((m) => m.id === c.model_id)]))
  const hotelById = new Map((hotels ?? []).map((h) => [h.id, h.name]))
  const repById = new Map((reps ?? []).map((r) => [r.id, r.full_name]))

  const sortByTime = (a: Movement, b: Movement, field: 'pickup_at' | 'dropoff_at') => {
    const ta = a[field], tb = b[field]
    if (ta && tb) return ta < tb ? -1 : ta > tb ? 1 : 0
    if (ta) return -1
    if (tb) return 1
    return a.ref.localeCompare(b.ref)
  }
  pickups.sort((a, b) => sortByTime(a, b, 'pickup_at'))
  returns.sort((a, b) => sortByTime(a, b, 'dropoff_at'))

  const fmtTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Athens' }) : '—'

  const row = (m: Movement, time: string) => {
    const model = modelByCarId.get(m.car_id)
    return (
      <tr key={m.id} className="border-b border-line last:border-0">
        <td className="py-2 pr-3 font-medium tabular-nums">{time}</td>
        <td className="py-2 pr-3 font-medium">{plateById.get(m.car_id) ?? '—'}</td>
        <td className="py-2 pr-3 text-ink-soft">{model ? `${model.make} ${model.model}` : '—'}</td>
        <td className="py-2 pr-3">{m.cust_first} {m.cust_last}</td>
        <td className="py-2 pr-3 text-ink-soft">{m.hotel_id ? hotelById.get(m.hotel_id) ?? '—' : '—'}</td>
        <td className="py-2 pr-3 text-ink-soft">{m.room_number ?? '—'}</td>
        <td className="py-2 pr-3 text-ink-soft">{repById.get(m.created_by) ?? '—'}</td>
      </tr>
    )
  }

  return (
    <div className="flex flex-col gap-6 print:gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
          <p className="text-[0.9375rem] text-ink-soft">{t('subtitle')}</p>
        </div>
        <div className="flex items-end gap-2">
          <form className="flex items-end gap-2">
            <div>
              <label className="ir-label" htmlFor="day">{t('day')}</label>
              <input id="day" name="day" type="date" defaultValue={day} className="ir-field" />
            </div>
            <button type="submit" className="ir-btn-quiet !w-auto">{t('go')}</button>
          </form>
          <PrintButton label={t('print')} />
        </div>
      </div>

      <p className="hidden text-[1.125rem] font-semibold print:block">{t('title')} — {day}</p>

      <section className="ir-card p-4 print:border-0 print:p-0">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('pickups')} ({pickups.length})</h2>
        {pickups.length === 0 ? (
          <p className="text-ink-soft">{t('noPickups')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[0.9375rem]">
              <thead>
                <tr className="border-b border-line-strong text-[0.8125rem] uppercase tracking-wide text-ink-soft">
                  <th className="py-2 pr-3 font-medium">{t('time')}</th>
                  <th className="py-2 pr-3 font-medium">{t('car')}</th>
                  <th className="py-2 pr-3 font-medium">{t('model')}</th>
                  <th className="py-2 pr-3 font-medium">{t('guest')}</th>
                  <th className="py-2 pr-3 font-medium">{t('hotel')}</th>
                  <th className="py-2 pr-3 font-medium">{t('room')}</th>
                  <th className="py-2 pr-3 font-medium">{t('rep')}</th>
                </tr>
              </thead>
              <tbody>{pickups.map((m) => row(m, fmtTime(m.pickup_at)))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ir-card p-4 print:border-0 print:p-0">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('returns')} ({returns.length})</h2>
        {returns.length === 0 ? (
          <p className="text-ink-soft">{t('noReturns')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[0.9375rem]">
              <thead>
                <tr className="border-b border-line-strong text-[0.8125rem] uppercase tracking-wide text-ink-soft">
                  <th className="py-2 pr-3 font-medium">{t('time')}</th>
                  <th className="py-2 pr-3 font-medium">{t('car')}</th>
                  <th className="py-2 pr-3 font-medium">{t('model')}</th>
                  <th className="py-2 pr-3 font-medium">{t('guest')}</th>
                  <th className="py-2 pr-3 font-medium">{t('hotel')}</th>
                  <th className="py-2 pr-3 font-medium">{t('room')}</th>
                  <th className="py-2 pr-3 font-medium">{t('rep')}</th>
                </tr>
              </thead>
              <tbody>{returns.map((m) => row(m, fmtTime(m.dropoff_at)))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function todayAthens(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' })
}
