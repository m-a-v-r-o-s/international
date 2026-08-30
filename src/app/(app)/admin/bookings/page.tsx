import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { searchAllBookings } from './actions'
import type { BookingRow } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.bookings')
  return { title: t('title') }
}

const COLUMNS =
  'id, ref, status, car_id, hotel_id, room_number, start_date, end_date, ' +
  'cust_first, cust_last, total_cents, created_by, created_at'

type Row = Pick<BookingRow,
  'id' | 'ref' | 'status' | 'car_id' | 'hotel_id' | 'room_number' | 'start_date' | 'end_date'
  | 'cust_first' | 'cust_last' | 'total_cents' | 'created_by' | 'created_at'>

/**
 * A5 · Bookings (docs/04-SCREENS.md) — every booking, every rep, every hotel.
 * Admin's RLS branch (app.is_admin()) has no created_by/hotel restriction, so
 * this is the same query R6 runs for a rep, minus the narrowing that only
 * exists for a rep. Search is filtered in application code, same reasoning as
 * R6 (docs/(app)/bookings/page.tsx): avoids building a PostgREST .or() filter
 * out of raw user input, and 'every rep/hotel/status' keeps this list well
 * under a size where that matters.
 */
export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAdmin()
  const t = await getTranslations('admin.bookings')
  const params = await searchParams
  const q = params.q?.trim() ?? ''
  const statusFilter = params.status ?? ''
  const supabase = await supabaseServer()

  const { data: bookings } = await supabase.from('bookings')
    .select(COLUMNS)
    .eq('kind', 'rental')
    .order('start_date', { ascending: false })
    .limit(1000)

  let rows = (bookings ?? []) as unknown as Row[]

  const carIds = [...new Set(rows.map((r) => r.car_id))]
  const hotelIds = [...new Set(rows.map((r) => r.hotel_id).filter((h): h is string => h !== null))]
  const repIds = [...new Set(rows.map((r) => r.created_by))]

  const [{ data: cars }, { data: hotels }, { data: reps }] = await Promise.all([
    carIds.length > 0 ? supabase.from('cars').select('id, plate').in('id', carIds) : Promise.resolve({ data: [] }),
    hotelIds.length > 0 ? supabase.from('hotels').select('id, name').in('id', hotelIds) : Promise.resolve({ data: [] }),
    repIds.length > 0 ? supabase.from('profiles').select('id, full_name').in('id', repIds) : Promise.resolve({ data: [] }),
  ])
  const plateById = new Map((cars ?? []).map((c) => [c.id, c.plate]))
  const hotelById = new Map((hotels ?? []).map((h) => [h.id, h.name]))
  const repById = new Map((reps ?? []).map((r) => [r.id, r.full_name]))

  if (statusFilter) rows = rows.filter((r) => r.status === statusFilter)

  if (q) {
    const needle = q.toLowerCase()
    rows = rows.filter((r) =>
      r.cust_first?.toLowerCase().includes(needle)
      || r.cust_last?.toLowerCase().includes(needle)
      || r.ref.toLowerCase().includes(needle)
      || (plateById.get(r.car_id) ?? '').toLowerCase().includes(needle)
      || (r.hotel_id ? (hotelById.get(r.hotel_id) ?? '') : '').toLowerCase().includes(needle)
      || (repById.get(r.created_by) ?? '').toLowerCase().includes(needle)
      || r.start_date.includes(needle)
      || r.end_date.includes(needle))
  }
  rows = rows.slice(0, 200)

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>

      <form action={searchAllBookings} className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="q">{t('searchLabel')}</label>
        <input
          id="q" name="q" type="search" defaultValue={q} className="ir-field flex-1"
          placeholder={t('searchPlaceholder')}
        />
        <button type="submit" className="ir-btn-quiet !w-auto">{t('search')}</button>
      </form>

      <form className="flex flex-wrap items-end gap-3">
        {q ? <input type="hidden" name="q" value={q} /> : null}
        <div>
          <label className="ir-label" htmlFor="status">{t('filterStatus')}</label>
          <select id="status" name="status" className="ir-field" defaultValue={statusFilter}>
            <option value="">{t('anyStatus')}</option>
            <option value="booked">{t('status.booked')}</option>
            <option value="out">{t('status.out')}</option>
            <option value="returned">{t('status.returned')}</option>
            <option value="cancelled">{t('status.cancelled')}</option>
            <option value="no_show">{t('status.no_show')}</option>
          </select>
        </div>
        <button type="submit" className="ir-btn-quiet !w-auto">{t('apply')}</button>
      </form>

      <p className="text-[0.875rem] text-ink-soft">{t('count', { n: rows.length })}</p>

      {rows.length === 0 ? (
        <p className="text-ink-soft">{q || statusFilter ? t('noResults') : t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((booking) => (
            <li key={booking.id}>
              <Link href={`/admin/bookings/${booking.id}`} className="ir-card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {booking.cust_first} {booking.cust_last} · {plateById.get(booking.car_id) ?? '—'}
                  </p>
                  <p className="truncate text-[0.8125rem] text-ink-soft">
                    {booking.start_date} → {booking.end_date} · {t(`status.${booking.status}`)}
                    {' · '}{booking.hotel_id ? hotelById.get(booking.hotel_id) ?? '—' : '—'}
                    {' · '}{repById.get(booking.created_by) ?? '—'}
                  </p>
                </div>
                {booking.total_cents !== null ? (
                  <span className="shrink-0 font-semibold">€{(booking.total_cents / 100).toFixed(2)}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
