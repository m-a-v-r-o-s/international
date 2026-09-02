import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { supabaseServer } from '@/lib/supabase/server'
import { Disclosure } from '@/components/Disclosure'
import { loadStaffWithHotels } from '@/lib/users/load'
import { CreateHotelForm, EditHotelForm, HotelStateForms } from '../hotels/HotelForms'

/**
 * A8's hotel half, folded into A10 Settings so the sidebar keeps its one
 * "Settings" entry (see the note at the top of page.tsx). It used to be its
 * own screen at /admin/hotels, which now only redirects here.
 *
 * A hotel is a location a rep is stationed at (docs/01-DECISIONS.md §3) and
 * the thing a booking belongs to, so each row lists the staff attached to it
 * — the same `hotel_reps` data the users screen writes, shown from the other
 * side, because "who can see this hotel's bookings" is the question the boss
 * is actually asking when he looks at a hotel.
 */
export async function HotelsSection() {
  const t = await getTranslations('admin.hotels')
  const tu = await getTranslations('admin.users')
  const supabase = await supabaseServer()

  const { staff, hotels } = await loadStaffWithHotels(supabase)

  const staffAt = (hotelId: string) => ({
    home: staff.filter((p) => p.homeHotel?.id === hotelId),
    cover: staff.filter((p) => p.coverHotels.some((h) => h.id === hotelId)),
  })

  return (
    <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="hotels-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="hotels-heading" className="text-[1.0625rem] font-semibold">{t('title')}</h2>
          <p className="text-[0.9375rem] text-ink-soft">{t('intro')}</p>
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
                  <h3 className="text-[1.0625rem] font-semibold">
                    {hotel.name}
                    {hotel.area ? (
                      <span className="ml-2 text-[0.875rem] font-normal text-ink-soft">
                        {hotel.area}
                      </span>
                    ) : null}
                  </h3>
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
                    <h4 className="ir-label">{t('staffAt')}</h4>
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
    </section>
  )
}
