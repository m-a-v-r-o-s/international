import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { loadDeskContext } from '@/lib/bookings/desk'
import { QuickBookingForm } from './QuickBookingForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('quickBooking')
  return { title: t('title') }
}

/**
 * R3b · Booking confirmation (docs/04-SCREENS.md, docs/01-DECISIONS.md §30).
 *
 * The phone rings, a guest orders a car, and the rep needs the car held before
 * the call ends. R3 asks for a name, a surname and a date of birth first, all
 * of them required, none of which the caller has necessarily given — so this
 * is the same booking with the identity deferred to pickup, where the licence
 * is read anyway (§9, §10).
 *
 * Reached from the header on every screen, by reps and by the admin alike
 * (§30 decision 1): a call does not wait for the right page to be open.
 */
export default async function BookingConfirmationPage() {
  await requireUnlocked()
  const t = await getTranslations('quickBooking')
  const supabase = await supabaseServer()

  const { cars, hotels, defaultHotelId, windows } = await loadDeskContext(supabase)
  if (cars.length === 0) notFound()

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">{t('intro')}</p>
      </div>
      <QuickBookingForm
        cars={cars}
        hotels={hotels}
        defaultHotelId={defaultHotelId}
        windows={windows}
        next="detail"
        submitLabel={t('confirm')}
      />
    </div>
  )
}
