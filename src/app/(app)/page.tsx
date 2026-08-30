import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'

/**
 * R1 · Today — a placeholder until the booking work lands. It exists so Phase 0
 * has an honest finish line: an admin and a rep can sign in, on a phone, in
 * either language, and land somewhere that knows who they are.
 */
export default async function HomePage() {
  const staff = await requireUnlocked()
  const t = await getTranslations('home')
  const tc = await getTranslations('common')

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
      <p className="text-ink-soft">{tc('signedInAs', { name: staff.fullName || '—' })}</p>

      <div className="ir-card p-5">
        <p>{t('welcome')}</p>
        <p className="mt-2 text-[0.9375rem] text-ink-soft">
          {staff.role === 'admin' ? t('adminNote') : t('repNote')}
        </p>
      </div>

      {staff.role === 'admin' ? (
        <Link href="/admin/cars" className="ir-btn-primary">{t('goToFleet')}</Link>
      ) : (
        <div className="flex flex-col gap-3">
          <Link href="/availability" className="ir-btn-primary">{t('goToAvailability')}</Link>
          <Link href="/bookings" className="ir-btn-quiet">{t('goToMyBookings')}</Link>
        </div>
      )}
    </div>
  )
}
