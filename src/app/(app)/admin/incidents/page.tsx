import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { filterIncidents } from './actions'
import type { BookingRow, IncidentRow } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.incidents')
  return { title: t('title') }
}

/**
 * A6 · Incidents queue (docs/04-SCREENS.md) — the boss's inbox, and the one
 * place a rep can put something the app has no other slot for.
 *
 * Read-heavy over rows that already exist, same shape as A1/A2/A5: no new RLS
 * policy and no new engine logic. Note what is NOT selected here — `charge`
 * and `resolution` are withheld from `authenticated` by column grant, admin
 * included, so `select *` is refused and the list shows only whether an item
 * is open or closed. The amount itself comes from admin_incident_detail() on
 * the item's own screen.
 */
export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAdmin()
  const t = await getTranslations('admin.incidents')
  const params = await searchParams
  const state = params.state === 'resolved' || params.state === 'all' ? params.state : 'open'
  const supabase = await supabaseServer()

  let query = supabase.from('incidents')
    .select('id, booking_id, note, raised_by, raised_at, resolved_at')
    .order('raised_at', { ascending: false })
    .limit(500)

  if (state === 'open') query = query.is('resolved_at', null)
  if (state === 'resolved') query = query.not('resolved_at', 'is', null)

  const { data } = await query
  const rows = (data ?? []) as IncidentRow[]

  const bookingIds = [...new Set(rows.map((r) => r.booking_id))]
  const repIds = [...new Set(rows.map((r) => r.raised_by).filter((v): v is string => v !== null))]
  const incidentIds = rows.map((r) => r.id)

  const [{ data: bookings }, { data: reps }, { data: photos }] = await Promise.all([
    bookingIds.length > 0
      ? supabase.from('bookings')
          .select('id, ref, car_id, cust_first, cust_last, start_date, end_date')
          .in('id', bookingIds)
      : Promise.resolve({ data: [] }),
    repIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', repIds)
      : Promise.resolve({ data: [] }),
    // Just the count per item for the list — the images themselves are signed
    // one screen deeper, where somebody is actually looking at them.
    incidentIds.length > 0
      ? supabase.from('incident_photos').select('id, incident_id').in('incident_id', incidentIds)
      : Promise.resolve({ data: [] }),
  ])

  type BookingSummary = Pick<BookingRow,
    'id' | 'ref' | 'car_id' | 'cust_first' | 'cust_last' | 'start_date' | 'end_date'>
  const bookingById = new Map(((bookings ?? []) as unknown as BookingSummary[]).map((b) => [b.id, b]))

  const carIds = [...new Set([...bookingById.values()].map((b) => b.car_id))]
  const { data: cars } = carIds.length > 0
    ? await supabase.from('cars').select('id, plate').in('id', carIds)
    : { data: [] }
  const plateById = new Map((cars ?? []).map((c) => [c.id, c.plate]))
  const repById = new Map((reps ?? []).map((r) => [r.id, r.full_name]))

  const photoCount = new Map<string, number>()
  for (const photo of (photos ?? []) as { incident_id: string }[]) {
    photoCount.set(photo.incident_id, (photoCount.get(photo.incident_id) ?? 0) + 1)
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('subtitle')}</p>
      </div>

      <form action={filterIncidents} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="ir-label" htmlFor="state">{t('filterState')}</label>
          <select id="state" name="state" className="ir-field" defaultValue={state}>
            <option value="open">{t('stateOpen')}</option>
            <option value="resolved">{t('stateResolved')}</option>
            <option value="all">{t('stateAll')}</option>
          </select>
        </div>
        <button type="submit" className="ir-btn-quiet !w-auto">{t('apply')}</button>
      </form>

      {rows.length === 0 ? (
        <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">
          {state === 'open' ? t('emptyOpen') : t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const booking = bookingById.get(row.booking_id)
            const shots = photoCount.get(row.id) ?? 0
            return (
              <li key={row.id}>
                <Link href={`/admin/incidents/${row.id}`} className="ir-card flex flex-col gap-1 p-3.5">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold">
                      {booking?.ref ?? '—'}
                      {booking ? ` · ${plateById.get(booking.car_id) ?? '—'}` : ''}
                    </span>
                    <span className={`shrink-0 rounded-field px-2.5 py-1 text-[0.8125rem] font-medium ${
                      row.resolved_at ? 'bg-ok-tint text-ok' : 'bg-warn-tint text-warn'
                    }`}>
                      {row.resolved_at ? t('resolved') : t('open')}
                    </span>
                  </span>
                  {row.note ? (
                    <span className="line-clamp-2 text-[0.9375rem]">{row.note}</span>
                  ) : (
                    <span className="text-[0.9375rem] text-ink-soft">{t('noNote')}</span>
                  )}
                  <span className="text-[0.8125rem] text-ink-soft">
                    {booking ? `${booking.cust_first ?? ''} ${booking.cust_last ?? ''}`.trim() : '—'}
                    {' · '}{row.raised_at.slice(0, 10)}
                    {row.raised_by ? ` · ${repById.get(row.raised_by) ?? '—'}` : ''}
                    {shots > 0 ? ` · ${t('photoCount', { n: shots })}` : ''}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
