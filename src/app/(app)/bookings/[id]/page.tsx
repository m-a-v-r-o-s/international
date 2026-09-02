import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { EditBookingForm } from './EditBookingForm'
import { ExtendBookingForm } from './ExtendBookingForm'
import { CancelForm } from './CancelForm'
import { signBookingFile } from '@/lib/storage/booking-files'
import { athensDateTime } from '@/lib/contract/data'
import { formatEuros } from '@/lib/money'
import type { BookingRow } from '@/lib/supabase/database.types'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const t = await getTranslations('bookingDetail')
  return { title: `${t('title')} ${id}` }
}

const BOOKING_COLUMNS =
  'id, ref, status, car_id, category_id, hotel_id, room_number, start_date, end_date, ' +
  'pickup_at, dropoff_at, cust_first, cust_last, cust_phone, cust_dob, ' +
  'total, days, collected, pay_method, paid, created_by, created_at'

/**
 * R7 · Booking detail (docs/04-SCREENS.md). Before pickup: edit anything, or
 * cancel. After pickup: read-only except Extend (docs/01-DECISIONS.md §18).
 * RLS already decides whether this row is visible at all — a rep reaching for
 * someone else's booking gets exactly the same not-found as a bad id, never a
 * distinguishable "forbidden" (that distinction would itself leak that the
 * booking exists).
 */
export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireUnlocked()
  const { id } = await params
  const t = await getTranslations('bookingDetail')
  const tt = await getTranslations('today')
  const tcs = await getTranslations('contractStep')
  const ti = await getTranslations('incidents')
  const supabase = await supabaseServer()

  const { data: booking } = await supabase.from('bookings')
    .select(BOOKING_COLUMNS)
    .eq('id', id).eq('kind', 'rental')
    .maybeSingle()

  if (!booking) notFound()
  const row = booking as unknown as Pick<BookingRow,
    'id' | 'ref' | 'status' | 'car_id' | 'category_id' | 'hotel_id' | 'room_number'
    | 'start_date' | 'end_date' | 'pickup_at' | 'dropoff_at'
    | 'cust_first' | 'cust_last' | 'cust_phone' | 'cust_dob'
    | 'total' | 'days' | 'collected' | 'pay_method' | 'paid' | 'created_by' | 'created_at'>

  const [{ data: car }, { data: hotelsResult }, { data: extras }, { data: contracts }] =
    await Promise.all([
      supabase.from('cars').select('id, plate, model_id').eq('id', row.car_id).maybeSingle(),
      supabase.rpc('staff_hotels'),
      supabase.from('booking_extras').select('id, seat, qty').eq('booking_id', row.id),
      // docs/04-SCREENS.md R6: "tap through to the full record and the signed
      // contract PDF". The latest version, behind a signed URL — there is no
      // public link to a signed agreement any more than to a licence image.
      supabase.from('contracts')
        .select('id, pdf_path, signed_at, signer_name, version')
        .eq('booking_id', row.id).order('version', { ascending: false }).limit(1),
    ])
  const contract = contracts?.[0] ?? null
  const contractUrl = await signBookingFile(supabase, contract?.pdf_path, {
    actorId: staff.id, ttlSeconds: 300,
  })
  const hotels = hotelsResult ?? []
  const hotelName = hotels.find((h) => h.id === row.hotel_id)?.name ?? null

  const beforePickup = row.status === 'booked'
  const isOut = row.status === 'out'
  const editable = beforePickup && (row.created_by === staff.id)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-[1.75rem] font-bold tracking-tight">{row.ref}</h1>
        <span className="rounded-field bg-brand-tint px-3 py-1 text-[0.875rem] font-medium text-brand">
          {t(`status.${row.status}`)}
        </span>
      </div>

      <section className="ir-card p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[0.9375rem]">
          <div>
            <dt className="text-ink-soft">{t('guest')}</dt>
            <dd className="font-medium">{row.cust_first} {row.cust_last}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('phone')}</dt>
            <dd className="font-medium">{row.cust_phone}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('car')}</dt>
            <dd className="font-medium">{car?.plate ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('hotelRoom')}</dt>
            <dd className="font-medium">{hotelName ?? '—'} {row.room_number ? `· ${row.room_number}` : ''}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('dates')}</dt>
            <dd className="font-medium">{row.start_date} → {row.end_date}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('days')}</dt>
            <dd className="font-medium">{row.days ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('price')}</dt>
            <dd className="font-semibold text-brand">
              {formatEuros(row.total)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('payment')}</dt>
            <dd className="font-medium">
              {row.paid ? t('paid') : t('unpaid')}
              {row.collected > 0 ? ` · ${formatEuros(row.collected)}` : ''}
            </dd>
          </div>
        </dl>

        {(extras ?? []).length > 0 ? (
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-ink-soft text-[0.875rem]">{t('extras')}</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {(extras ?? []).map((e) => (
                <li key={e.id} className="rounded-field bg-canvas px-2.5 py-1 text-[0.8125rem]">
                  {t(`seat.${e.seat}`)}{e.qty > 1 ? ` ×${e.qty}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {contract ? (
        <section className="ir-card p-4">
          <h2 className="mb-1 text-[1.0625rem] font-semibold">{tcs('agreementTitle')}</h2>
          <p className="mb-3 text-[0.9375rem] text-ink-soft">
            {tcs('signedBy', {
              name: contract.signer_name,
              when: athensDateTime(contract.signed_at),
            })}
          </p>
          {contractUrl ? (
            <a href={contractUrl} target="_blank" rel="noreferrer" className="ir-btn-quiet">
              {tcs('openSigned')}
            </a>
          ) : null}
        </section>
      ) : null}

      {beforePickup ? (
        <Link href={`/bookings/${row.id}/pickup`} className="ir-btn-primary">{tt('startPickup')}</Link>
      ) : null}

      {isOut ? (
        <Link href={`/bookings/${row.id}/return`} className="ir-btn-primary">{tt('startReturn')}</Link>
      ) : null}

      {/* Anything wrong with this car, in the rep's own words and photographs.
          The link pre-selects the contract; it is not what authorises the
          report, which the incidents policy decides for itself. */}
      <Link href={`/incidents/new?booking=${row.id}`} className="ir-btn-quiet">
        {ti('reportAction')}
      </Link>

      {editable ? (
        <section className="ir-card p-4">
          <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('editTitle')}</h2>
          <EditBookingForm booking={row} hotels={hotels} />
        </section>
      ) : null}

      {isOut && (row.created_by === staff.id) ? (
        <section className="ir-card p-4">
          <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('extendTitle')}</h2>
          <p className="mb-3 text-[0.875rem] text-ink-soft">{t('extendHint')}</p>
          <ExtendBookingForm bookingId={row.id} carId={row.car_id} currentEnd={row.end_date} />
        </section>
      ) : null}

      {editable ? (
        <section className="ir-card p-4">
          <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('cancelTitle')}</h2>
          <CancelForm bookingId={row.id} />
        </section>
      ) : null}
    </div>
  )
}
