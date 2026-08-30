import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { searchMyBookings } from './actions'
import type { BookingRow } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('myBookings')
  return { title: t('title') }
}

/**
 * R6 · My bookings (docs/04-SCREENS.md). RLS already narrows this to exactly
 * what a rep may see — their own bookings, and their hotel's — so the query
 * below is the same `select` any rep session would run; there is no second
 * filter to get right. No totals are ever computed from this list
 * (docs/01-DECISIONS.md §7): each row shows its own price, nothing summed.
 */
export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireUnlocked()
  const t = await getTranslations('myBookings')
  const params = await searchParams
  const q = params.q?.trim() ?? ''
  const supabase = await supabaseServer()

  // RLS already narrows this to a rep's own and their hotel's bookings, which
  // is a small set — filtering the search term in application code avoids
  // building a PostgREST .or() filter string out of raw user input, where a
  // comma or period in the query could otherwise be read as filter syntax.
  const { data: bookings } = await supabase.from('bookings')
    .select('id, ref, status, car_id, start_date, end_date, cust_first, cust_last, total_cents, created_at')
    .eq('kind', 'rental')
    .order('start_date', { ascending: false })
    .limit(500)

  let rows = (bookings ?? []) as Pick<
    BookingRow, 'id' | 'ref' | 'status' | 'car_id' | 'start_date' | 'end_date'
    | 'cust_first' | 'cust_last' | 'total_cents' | 'created_at'
  >[]

  const carIds = [...new Set(rows.map((r) => r.car_id))]
  const { data: cars } = carIds.length > 0
    ? await supabase.from('cars').select('id, plate').in('id', carIds)
    : { data: [] }
  const plateById = new Map((cars ?? []).map((c) => [c.id, c.plate]))

  if (q) {
    const needle = q.toLowerCase()
    rows = rows.filter((r) =>
      r.cust_first?.toLowerCase().includes(needle)
      || r.cust_last?.toLowerCase().includes(needle)
      || r.ref.toLowerCase().includes(needle)
      || (plateById.get(r.car_id) ?? '').toLowerCase().includes(needle)
      || r.start_date.includes(needle)
      || r.end_date.includes(needle))
  }
  rows = rows.slice(0, 100)

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>

      <form action={searchMyBookings} className="flex gap-2">
        <label className="sr-only" htmlFor="q">{t('searchLabel')}</label>
        <input
          id="q" name="q" type="search" defaultValue={q} className="ir-field"
          placeholder={t('searchPlaceholder')}
        />
        <button type="submit" className="ir-btn-quiet !w-auto">{t('search')}</button>
      </form>

      {rows.length === 0 ? (
        <p className="text-ink-soft">{q ? t('noResults') : t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((booking) => (
            <li key={booking.id}>
              <Link href={`/bookings/${booking.id}`} className="ir-card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {booking.cust_first} {booking.cust_last} · {plateById.get(booking.car_id) ?? '—'}
                  </p>
                  <p className="truncate text-[0.8125rem] text-ink-soft">
                    {booking.start_date} → {booking.end_date} · {t(`status.${booking.status}`)}
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
