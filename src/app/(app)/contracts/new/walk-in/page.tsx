import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { loadDeskContext } from '@/lib/bookings/desk'
import { nowTimeAthens, todayAthens } from '@/lib/dates'
import { QuickBookingForm } from '@/app/(app)/bookings/confirm/QuickBookingForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('writeContract')
  return { title: t('walkInTitle') }
}

/**
 * R4b · the walk-in (docs/01-DECISIONS.md §30 decision 3).
 *
 * Someone arrives at the desk wanting a car now, with no booking behind them.
 * A contract still cannot exist on its own — `contracts.booking_id` is a NOT
 * NULL foreign key — so a rental is created first, here, and the rep is put
 * straight into licence capture without having to go and find what they just
 * made. It is the R3b form with `next="pickup"`; there is no second way to
 * write a booking.
 *
 * The dates default to today → today, which is one day by §4's inclusive
 * count, and both stay editable: a walk-in usually wants a few days and says
 * so at the desk.
 *
 * What happens after the signature is the rest of R4, unchanged — fuel out,
 * the damage diagram, payment, and the booked → out transition that the
 * eligibility hard block sits on (§11). The owner chose that ordering
 * deliberately over stopping at the signed PDF: the guest is standing there
 * with the keys in reach, and a rental left half-processed at the moment the
 * car drives away is the paper problem this app exists to replace.
 */
export default async function WalkInPage() {
  await requireUnlocked()
  const t = await getTranslations('writeContract')
  const supabase = await supabaseServer()

  const { cars, hotels, defaultHotelId, windows } = await loadDeskContext(supabase)
  if (cars.length === 0) notFound()

  const today = todayAthens()

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/contracts/new" className="text-[0.9375rem] text-brand underline underline-offset-2">
          ← {t('title')}
        </Link>
        <h1 className="mt-1 text-[1.75rem] font-bold tracking-tight">{t('walkInTitle')}</h1>
        <p className="text-ink-soft">{t('walkInFormIntro')}</p>
      </div>

      <QuickBookingForm
        cars={cars}
        hotels={hotels}
        defaultHotelId={defaultHotelId}
        windows={windows}
        next="pickup"
        defaultFrom={today}
        defaultTo={today}
        // A walk-in is picking the car up NOW, not in the morning window. The
        // field still shows it and is still editable; what it must not do is
        // record 08:30 on a rental that left at three in the afternoon.
        pickupTimeDefault={nowTimeAthens()}
        submitLabel={t('walkInSubmit')}
      />
    </div>
  )
}
