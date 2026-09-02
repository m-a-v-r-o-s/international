import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { filterExceptions } from './actions'
import type { BookingRow, ExceptionRow, ExceptionType } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.exceptions')
  return { title: t('title') }
}

const TYPES: ExceptionType[] = [
  'fuel_short', 'new_damage', 'late_return', 'no_show', 'eligibility_override', 'other',
]

/**
 * A6 · Exceptions queue (docs/04-SCREENS.md) — the boss's inbox, and the one
 * place every non-standard event in the business lands: fuel shortfalls and
 * new damage from R5, eligibility overrides from admin_override_eligibility(),
 * late returns and no-shows from elsewhere.
 *
 * Read-heavy over rows that already exist, same shape as A1/A2/A5: no new RLS
 * policy and no new engine logic. Note what is NOT selected here —
 * `charge` and `resolution` are withheld from `authenticated` by column
 * grant, admin included, so `select *` is refused and the list shows only
 * whether an item is open or closed. The amount itself comes from
 * admin_exception_detail() on the item's own screen.
 */
export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireAdmin()
  const t = await getTranslations('admin.exceptions')
  const params = await searchParams
  const state = params.state === 'resolved' || params.state === 'all' ? params.state : 'open'
  const typeFilter = TYPES.includes(params.type as ExceptionType) ? (params.type as ExceptionType) : ''
  const supabase = await supabaseServer()

  let query = supabase.from('exceptions')
    .select('id, booking_id, type, detail, raised_by, raised_at, resolved_at')
    .order('raised_at', { ascending: false })
    .limit(500)

  if (state === 'open') query = query.is('resolved_at', null)
  if (state === 'resolved') query = query.not('resolved_at', 'is', null)
  if (typeFilter) query = query.eq('type', typeFilter)

  const { data } = await query
  const rows = (data ?? []) as ExceptionRow[]

  const bookingIds = [...new Set(rows.map((r) => r.booking_id))]
  const repIds = [...new Set(rows.map((r) => r.raised_by).filter((v): v is string => v !== null))]

  const [{ data: bookings }, { data: reps }] = await Promise.all([
    bookingIds.length > 0
      ? supabase.from('bookings')
          .select('id, ref, car_id, cust_first, cust_last, start_date, end_date')
          .in('id', bookingIds)
      : Promise.resolve({ data: [] }),
    repIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', repIds)
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

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('subtitle')}</p>
      </div>

      <form action={filterExceptions} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="ir-label" htmlFor="state">{t('filterState')}</label>
          <select id="state" name="state" className="ir-field" defaultValue={state}>
            <option value="open">{t('stateOpen')}</option>
            <option value="resolved">{t('stateResolved')}</option>
            <option value="all">{t('stateAll')}</option>
          </select>
        </div>
        <div>
          <label className="ir-label" htmlFor="type">{t('filterType')}</label>
          <select id="type" name="type" className="ir-field" defaultValue={typeFilter}>
            <option value="">{t('anyType')}</option>
            {TYPES.map((type) => <option key={type} value={type}>{t(`type.${type}`)}</option>)}
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
            return (
              <li key={row.id}>
                <Link href={`/admin/exceptions/${row.id}`} className="ir-card flex flex-col gap-1 p-3.5">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{t(`type.${row.type}`)}</span>
                    <span className={`shrink-0 rounded-field px-2.5 py-1 text-[0.8125rem] font-medium ${
                      row.resolved_at ? 'bg-ok-tint text-ok' : 'bg-warn-tint text-warn'
                    }`}>
                      {row.resolved_at ? t('resolved') : t('open')}
                    </span>
                  </span>
                  <span className="text-[0.9375rem]">
                    {booking?.ref ?? '—'} · {booking ? `${booking.cust_first ?? ''} ${booking.cust_last ?? ''}`.trim() : '—'}
                    {booking ? ` · ${plateById.get(booking.car_id) ?? '—'}` : ''}
                  </span>
                  {row.detail ? <span className="text-[0.875rem] text-ink-soft">{row.detail}</span> : null}
                  <span className="text-[0.8125rem] text-ink-soft">
                    {row.raised_at.slice(0, 10)}
                    {row.raised_by ? ` · ${repById.get(row.raised_by) ?? '—'}` : ''}
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
