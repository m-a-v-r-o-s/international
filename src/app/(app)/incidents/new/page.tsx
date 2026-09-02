import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { ReportForm } from './ReportForm'
import type { BookingRow } from '@/lib/supabase/database.types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('incidents')
  return { title: t('reportTitle') }
}

/**
 * R9 · Report an incident.
 *
 * Which contract, then words and photographs. The contract list is the same
 * set R6 shows — RLS narrows it to this rep's own bookings and their hotel's,
 * so there is nothing to filter here — with the most recent first, because the
 * thing a rep is reporting on is nearly always the car in front of them.
 *
 * `?booking=` pre-selects, which is how the button on a booking's own screen
 * arrives. It is a convenience and not a permission: an id for a booking this
 * rep cannot read simply is not in the list, and the insert would be refused
 * by the policy regardless of what the form sends.
 */
export default async function NewIncidentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireUnlocked()
  const t = await getTranslations('incidents')
  const params = await searchParams
  const supabase = await supabaseServer()

  const { data } = await supabase.from('bookings')
    .select('id, ref, car_id, cust_first, cust_last, start_date, end_date')
    .eq('kind', 'rental')
    .order('start_date', { ascending: false })
    .limit(200)

  type BookingSummary = Pick<BookingRow,
    'id' | 'ref' | 'car_id' | 'cust_first' | 'cust_last' | 'start_date' | 'end_date'>
  const bookings = (data ?? []) as unknown as BookingSummary[]

  const carIds = [...new Set(bookings.map((b) => b.car_id))]
  const { data: cars } = carIds.length > 0
    ? await supabase.from('cars').select('id, plate').in('id', carIds)
    : { data: [] }
  const plateById = new Map((cars ?? []).map((c) => [c.id, c.plate]))

  const options = bookings.map((b) => ({
    id: b.id,
    label: [
      b.ref,
      plateById.get(b.car_id) ?? '—',
      `${b.cust_first ?? ''} ${b.cust_last ?? ''}`.trim() || '—',
      `${b.start_date} → ${b.end_date}`,
    ].join(' · '),
  }))

  const preselected = options.some((o) => o.id === params.booking) ? params.booking : undefined

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/incidents" className="text-[0.9375rem] text-brand underline underline-offset-2">
          ← {t('title')}
        </Link>
        <h1 className="mt-1 text-[1.75rem] font-bold tracking-tight">{t('reportTitle')}</h1>
        <p className="text-ink-soft">{t('reportIntro')}</p>
      </div>

      {options.length === 0 ? (
        <p className="text-ink-soft">{t('noBookings')}</p>
      ) : (
        <ReportForm bookings={options} defaultBookingId={preselected} />
      )}
    </div>
  )
}
