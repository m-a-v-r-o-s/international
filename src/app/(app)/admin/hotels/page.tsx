import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { Disclosure } from '@/components/Disclosure'
import { loadStaffWithHotels } from '@/lib/users/load'
import { CreateHotelForm, EditHotelForm, HotelStateForms } from './HotelForms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.hotels')
  return { title: t('title') }
}

/**
 * A8's hotel half, back on its own screen. It lived inline in A10 Settings
 * for a while (see the note at the top of settings/page.tsx) so the sidebar
 * kept exactly one "Settings" entry; the boss found that Settings page too
 * long to scan, so Settings now links here instead of embedding this.
 *
 * A hotel is a location a rep is stationed at (docs/01-DECISIONS.md §3) and
 * the thing a booking belongs to, so each row lists the staff attached to it
 * — the same `hotel_reps` data the users screen writes, shown from the other
 * side, because "who can see this hotel's bookings" is the question the boss
 * is actually asking when he looks at a hotel.
 */
export default async function AdminHotelsPage() {
  await requireAdmin()
  const t = await getTranslations('admin.hotels')
  const tu = await getTranslations('admin.users')
  const ts = await getTranslations('adminSettings')
  const supabase = await supabaseServer()

  const { staff, hotels } = await loadStaffWithHotels(supabase)

  const staffAt = (hotelId: string) => ({
    home: staff.filter((p) => p.homeHotel?.id === hotelId),
    cover: staff.filter((p) => p.coverHotels.some((h) => h.id === hotelId)),
  })

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/settings" className="text-[0.9375rem] text-brand underline-offset-2 hover:underline">
        ← {ts('title')}
      </Link>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
          <p className="text-ink-soft">{t('intro')}</p>
        </div>
        <p className="text-[0.9375rem] text-ink-soft">{t('count', { n: hotels.length })}</p>
      </div>

      <Disclosure summary={`+ ${t('add')}`}>
        <CreateHotelForm />
      </Disclosure>

      {hotels.length === 0 ? (
        <p className="text-ink-soft">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {hotels.map((hotel) => {
            const here = staffAt(hotel.id)
            const total = here.home.length + here.cover.length
            return (
              <li key={hotel.id} className="ir-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-[1.0625rem] font-semibold">
                    {hotel.name}
                    {hotel.area ? (
                      <span className="ml-2 text-[0.875rem] font-normal text-ink-soft">
                        {hotel.area}
                      </span>
                    ) : null}
                  </h2>
                  <span className="flex items-center gap-2 text-[0.8125rem]">
                    <span className="text-ink-soft">{t('staffCount', { n: total })}</span>
                    {hotel.active ? null : (
                      <span className="rounded-full bg-danger px-2 py-0.5 font-bold text-white">
                        {t('inactiveBadge')}
                      </span>
                    )}
                  </span>
                </div>

                {hotel.address ? (
                  <p className="mt-1 whitespace-pre-line text-[0.9375rem] text-ink-soft">
                    {hotel.address}
                  </p>
                ) : null}

                {total > 0 ? (
                  <div className="mt-3">
                    <h3 className="ir-label">{t('staffAt')}</h3>
                    <ul className="flex flex-col gap-1">
                      {here.home.map((p) => (
                        <li key={p.id} className="text-[0.9375rem]">
                          <Link
                            href={`/admin/users/${p.id}`}
                            className="text-brand underline-offset-2 hover:underline"
                          >
                            {p.full_name || p.email}
                          </Link>
                          <span className="ml-2 text-ink-soft">{t('homeTag')}</span>
                        </li>
                      ))}
                      {here.cover.map((p) => (
                        <li key={p.id} className="text-[0.9375rem]">
                          <Link
                            href={`/admin/users/${p.id}`}
                            className="text-brand underline-offset-2 hover:underline"
                          >
                            {p.full_name || p.email}
                          </Link>
                          <span className="ml-2 text-ink-soft">{t('coverTag')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-col gap-3">
                  <Disclosure summary={t('edit')}>
                    <EditHotelForm hotel={hotel} />
                  </Disclosure>
                  <Disclosure summary={hotel.active ? t('deactivate') : t('reactivate')}>
                    <HotelStateForms hotel={hotel} />
                  </Disclosure>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Link href="/admin/users" className="ir-btn-quiet">{tu('title')}</Link>
    </div>
  )
}
