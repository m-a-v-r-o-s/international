import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'

/**
 * Everything under /admin requires the admin role. requireAdmin() re-checks
 * this on every request; RLS re-checks it again underneath. A rep who guesses
 * one of these URLs gets redirected before a single query runs.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  const t = await getTranslations('admin')

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label={t('navLabel')} className="-mx-5 overflow-x-auto px-5 print:hidden">
        <ul className="flex gap-1 whitespace-nowrap">
          <li><Link href="/admin/movements" className="ir-btn-quiet !w-auto">{t('nav.movements')}</Link></li>
          <li><Link href="/admin/fleet-board" className="ir-btn-quiet !w-auto">{t('nav.fleetBoard')}</Link></li>
          <li><Link href="/admin/cars" className="ir-btn-quiet !w-auto">{t('nav.cars')}</Link></li>
          <li><Link href="/admin/categories" className="ir-btn-quiet !w-auto">{t('nav.categories')}</Link></li>
          <li><Link href="/admin/pricing" className="ir-btn-quiet !w-auto">{t('nav.pricing')}</Link></li>
          <li><Link href="/admin/bookings" className="ir-btn-quiet !w-auto">{t('nav.bookings')}</Link></li>
          <li><Link href="/admin/exceptions" className="ir-btn-quiet !w-auto">{t('nav.exceptions')}</Link></li>
          <li><Link href="/admin/users" className="ir-btn-quiet !w-auto">{t('nav.users')}</Link></li>
          <li><Link href="/admin/hotels" className="ir-btn-quiet !w-auto">{t('nav.hotels')}</Link></li>
          <li><Link href="/admin/audit" className="ir-btn-quiet !w-auto">{t('nav.audit')}</Link></li>
          <li><Link href="/admin/settings" className="ir-btn-quiet !w-auto">{t('nav.settings')}</Link></li>
        </ul>
      </nav>
      {children}
    </div>
  )
}
