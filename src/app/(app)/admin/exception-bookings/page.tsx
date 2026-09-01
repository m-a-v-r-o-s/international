import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { athensDateTime } from '@/lib/contract/data'
import { ExceptionBookingActions } from './ExceptionBookingActions'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.exceptionBookings')
  return { title: t('title') }
}

type PendingRow = {
  booking_id: string
  ref: string
  plate: string
  hotel_name: string | null
  room_number: string | null
  guest: string | null
  pickup_at: string | null
  reason: string | null
}

/**
 * The boss's queue for the escape hatch a rep uses to send a booking through
 * despite something not checking out — an out-of-window pick-up, or one made
 * without a verified email (docs/01-DECISIONS.md, "Exception bookings wait
 * for the boss"). The car is already held; nothing else happens to the
 * booking until it is approved or denied here.
 *
 * Read through public.admin_pending_exception_bookings() rather than the
 * table directly, the same shape as A5/A6's own queues: the columns here are
 * already visible to an admin through the ordinary policy, so this is a
 * settled list rather than a new grant.
 */
export default async function ExceptionBookingsPage() {
  await requireAdmin()
  const t = await getTranslations('admin.exceptionBookings')
  const supabase = await supabaseServer()

  const { data } = await supabase.rpc('admin_pending_exception_bookings')
  const rows = (data ?? []) as PendingRow[]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('subtitle')}</p>
      </div>

      {rows.length === 0 ? (
        <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.booking_id} className="ir-card flex flex-col gap-2 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{row.ref}</span>
                <span className="text-[0.9375rem] text-ink-soft">{row.plate}</span>
              </div>
              <div className="text-[0.9375rem]">
                <span className="text-ink-soft">{t('guest')}: </span>{row.guest ?? '—'}
              </div>
              <div className="text-[0.9375rem]">
                <span className="text-ink-soft">{t('hotelRoom')}: </span>
                {row.hotel_name ?? '—'}{row.room_number ? ` — ${row.room_number}` : ''}
              </div>
              <div className="text-[0.9375rem]">
                <span className="text-ink-soft">{t('pickup')}: </span>{athensDateTime(row.pickup_at)}
              </div>
              {row.reason ? (
                <div className="text-[0.9375rem]">
                  <span className="text-ink-soft">{t('reason')}: </span>{row.reason}
                </div>
              ) : null}
              <ExceptionBookingActions bookingId={row.booking_id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
