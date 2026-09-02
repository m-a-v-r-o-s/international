import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { formatEuros } from '@/lib/money'
import { supabaseServer } from '@/lib/supabase/server'
import { AdminEditBookingForm } from './AdminEditBookingForm'
import { PriceForm } from './PriceForm'
import type { BookingRow } from '@/lib/supabase/database.types'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const t = await getTranslations('admin.bookings')
  return { title: `${t('title')} — ${id}` }
}

const COLUMNS =
  'id, ref, status, car_id, hotel_id, room_number, start_date, end_date, ' +
  'pickup_at, dropoff_at, cust_first, cust_last, cust_phone, cust_dob, cust_email, ' +
  'total, days, collected, pay_method, paid, created_by, created_at'

type Row = Pick<BookingRow,
  'id' | 'ref' | 'status' | 'car_id' | 'hotel_id' | 'room_number' | 'start_date' | 'end_date'
  | 'pickup_at' | 'dropoff_at' | 'cust_first' | 'cust_last' | 'cust_phone' | 'cust_dob' | 'cust_email'
  | 'total' | 'days' | 'collected' | 'pay_method' | 'paid' | 'created_by' | 'created_at'>

/**
 * A5 · One booking, full edit rights at any stage (docs/04-SCREENS.md and
 * docs/03-SECURITY.md's "Any other post-pickup edit" row). Unlike R7, there is
 * no `beforePickup`/`editable` gate here — the admin branch of
 * app.bookings_before_write() does not lock fields to the booking's stage, so
 * the form is the same regardless of status. Every change lands in
 * audit_log through the existing trigger (docs/01-DECISIONS.md §19); this
 * screen adds no logging of its own.
 */
export default async function AdminBookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const t = await getTranslations('admin.bookings')
  const tb = await getTranslations('bookingDetail')
  const supabase = await supabaseServer()

  const { data: booking } = await supabase.from('bookings')
    .select(COLUMNS).eq('id', id).eq('kind', 'rental').maybeSingle()

  if (!booking) notFound()
  const row = booking as unknown as Row

  const [{ data: car }, { data: hotels }, { data: cars }, { data: extras }, { data: rep }] = await Promise.all([
    supabase.from('cars').select('id, plate, model_id').eq('id', row.car_id).maybeSingle(),
    supabase.from('hotels').select('id, name, area').order('name'),
    supabase.from('cars').select('id, plate, model_id').is('archived_at', null).order('plate'),
    supabase.from('booking_extras').select('id, seat, qty').eq('booking_id', row.id),
    supabase.from('profiles').select('id, full_name').eq('id', row.created_by).maybeSingle(),
  ])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-[1.75rem] font-bold tracking-tight">{row.ref}</h1>
        <span className="rounded-field bg-brand-tint px-3 py-1 text-[0.875rem] font-medium text-brand">
          {tb(`status.${row.status}`)}
        </span>
      </div>
      <Link href="/admin/bookings" className="text-[0.9375rem] text-brand underline-offset-2 hover:underline">
        {t('backToBookings')}
      </Link>

      <section className="ir-card p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[0.9375rem]">
          <div>
            <dt className="text-ink-soft">{tb('car')}</dt>
            <dd className="font-medium">{car?.plate ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('createdBy')}</dt>
            <dd className="font-medium">{rep?.full_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{tb('price')}</dt>
            <dd className="font-semibold text-brand">
              {formatEuros(row.total)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">{tb('days')}</dt>
            <dd className="font-medium">{row.days ?? '—'}</dd>
          </div>
        </dl>

        {(extras ?? []).length > 0 ? (
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-ink-soft text-[0.875rem]">{tb('extras')}</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {(extras ?? []).map((e) => (
                <li key={e.id} className="rounded-field bg-canvas px-2.5 py-1 text-[0.8125rem]">
                  {tb(`seat.${e.seat}`)}{e.qty > 1 ? ` ×${e.qty}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('editTitle')}</h2>
        <AdminEditBookingForm booking={row} hotels={hotels ?? []} cars={cars ?? []} />
      </section>

      <section className="ir-card p-4">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('priceTitle')}</h2>
        <p className="mb-3 text-[0.875rem] text-ink-soft">{t('priceHint')}</p>
        <PriceForm bookingId={row.id} total={row.total} />
      </section>
    </div>
  )
}
