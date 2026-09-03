import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import type { BookingRow, IncidentRow } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('incidents')
  return { title: t('title') }
}

/**
 * R9 · What this rep has sent in (docs/04-SCREENS.md).
 *
 * The same select the boss's A6 runs, narrowed by nothing in this file: RLS
 * already limits it to the bookings this rep may read, so there is no second
 * filter here to get wrong. What a rep does NOT see is the outcome in money —
 * `charge` and `resolution` are outside their column grant entirely, so this
 * list can say whether the boss has dealt with an item and never what he
 * decided it cost (docs/01-DECISIONS.md §14).
 */
export default async function MyIncidentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireUnlocked()
  const t = await getTranslations('incidents')
  const params = await searchParams
  const supabase = await supabaseServer()

  const { data } = await supabase.from('incidents')
    .select('id, booking_id, note, raised_at, resolved_at')
    .order('raised_at', { ascending: false })
    .limit(100)

  const rows = (data ?? []) as Pick<IncidentRow,
    'id' | 'booking_id' | 'note' | 'raised_at' | 'resolved_at'>[]

  const bookingIds = [...new Set(rows.map((r) => r.booking_id))]
  const { data: bookings } = bookingIds.length > 0
    ? await supabase.from('bookings')
        .select('id, ref, car_id, cust_first, cust_last').in('id', bookingIds)
    : { data: [] }

  type BookingSummary = Pick<BookingRow, 'id' | 'ref' | 'car_id' | 'cust_first' | 'cust_last'>
  const bookingById = new Map(
    ((bookings ?? []) as unknown as BookingSummary[]).map((b) => [b.id, b]))

  const carIds = [...new Set([...bookingById.values()].map((b) => b.car_id))]
  const { data: cars } = carIds.length > 0
    ? await supabase.from('cars').select('id, plate').in('id', carIds)
    : { data: [] }
  const plateById = new Map((cars ?? []).map((c) => [c.id, c.plate]))

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('subtitle')}</p>
      </div>

      {params.sent ? (
        <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">{t('sent')}</p>
      ) : null}

      <Link href="/incidents/new" className="ir-btn-primary">{t('reportAction')}</Link>

      {rows.length === 0 ? (
        <p className="text-ink-soft">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const booking = bookingById.get(row.booking_id)
            return (
              <li key={row.id} className="ir-card flex flex-col gap-1 p-3.5">
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    {booking?.ref ?? '–'}
                    {booking ? ` · ${plateById.get(booking.car_id) ?? '–'}` : ''}
                  </span>
                  <span className={`shrink-0 rounded-field px-2.5 py-1 text-[0.8125rem] font-medium ${
                    row.resolved_at ? 'bg-ok-tint text-ok' : 'bg-warn-tint text-warn'
                  }`}>
                    {row.resolved_at ? t('closed') : t('withManager')}
                  </span>
                </span>
                {row.note ? (
                  <span className="line-clamp-2 text-[0.9375rem]">{row.note}</span>
                ) : null}
                <span className="text-[0.8125rem] text-ink-soft">{row.raised_at.slice(0, 10)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
