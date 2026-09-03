import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations, getFormatter } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { loadStaffWithHotels } from '@/lib/users/load'
import {
  CoverForm, HomeHotelForm, ReissuePinForm, RemoveAccessForm, RemoveCoverForm, RestoreAccessForm,
  RoleForm, StaffDetailsForm,
} from '../StaffForms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.users')
  return { title: t('title') }
}

/**
 * One staff member. The hotel sections are the load-bearing half of the page:
 * `hotel_reps` is what app.my_hotel_ids() reads, and that is what the §8
 * cover-shift rule is built on, so every control here re-shapes who can see
 * whose bookings in both directions at once.
 *
 * The boss's own row deliberately has no role or access controls on it.
 * public.admin_set_user_role() and public.admin_set_user_active() both refuse
 * to act on the caller (IR113), so this is the screen agreeing with the
 * database rather than a second rule — but showing a button that always fails
 * would be worse than showing why it is not there.
 */
export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params
  const t = await getTranslations('admin.users')
  const format = await getFormatter()
  const supabase = await supabaseServer()

  const { staff, hotels } = await loadStaffWithHotels(supabase)
  const person = staff.find((p) => p.id === id)
  if (!person) notFound()

  const isSelf = person.id === admin.id
  const activeHotels = hotels.filter((h) => h.active || h.id === person.homeHotel?.id)

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/users" className="text-[0.9375rem] text-brand underline-offset-2 hover:underline">
        ← {t('backToStaff')}
      </Link>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[1.75rem] font-bold tracking-tight">
          {person.full_name || person.email}
        </h1>
        <span className="text-[0.8125rem]">
          <span className={`rounded-full px-2 py-0.5 font-bold text-white ${
            person.active ? 'bg-ok' : 'bg-danger'
          }`}>
            {person.active ? t('activeBadge') : t('inactiveBadge')}
          </span>
        </span>
      </div>

      <dl className="ir-card grid grid-cols-1 gap-x-4 gap-y-1 p-4 text-[0.9375rem] sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-ink-soft">{t('email')}</dt>
          <dd className="break-all">{person.email}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-ink-soft">{t('lastSignIn')}</dt>
          <dd>
            {person.last_sign_in_at
              ? format.dateTime(new Date(person.last_sign_in_at), {
                  dateStyle: 'medium', timeStyle: 'short',
                })
              : t('neverSignedIn')}
          </dd>
        </div>
      </dl>

      {isSelf ? (
        <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
          {t('selfNotice')}
        </p>
      ) : null}

      <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="details-heading">
        <h2 id="details-heading" className="text-[1.0625rem] font-semibold">
          {t('detailsTitle')}
        </h2>
        <StaffDetailsForm person={person} />
      </section>

      <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="hotels-heading">
        <h2 id="hotels-heading" className="text-[1.0625rem] font-semibold">
          {t('homeHotel')}
        </h2>

        {hotels.length === 0 ? (
          <div>
            <p className="text-[0.9375rem] text-ink-soft">{t('noHotels')}</p>
            <Link href="/admin/hotels" className="ir-btn-quiet mt-3">{t('goToHotels')}</Link>
          </div>
        ) : (
          <HomeHotelForm
            person={{ id: person.id, homeHotelId: person.homeHotel?.id ?? null }}
            hotels={activeHotels}
          />
        )}
      </section>

      {hotels.length > 0 ? (
        <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="cover-heading">
          <h2 id="cover-heading" className="text-[1.0625rem] font-semibold">
            {t('coverTitle')}
          </h2>
          <p className="text-[0.9375rem] text-ink-soft">{t('coverHint')}</p>

          {person.coverHotels.length === 0 ? (
            <p className="text-[0.9375rem] text-ink-soft">{t('noCover')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {person.coverHotels.map((hotel) => (
                <li key={hotel.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[0.9375rem]">
                    {hotel.area ? `${hotel.name} — ${hotel.area}` : hotel.name}
                  </span>
                  <RemoveCoverForm personId={person.id} hotel={hotel} />
                </li>
              ))}
            </ul>
          )}

          <CoverForm
            person={{ id: person.id }}
            hotels={activeHotels.filter((h) => h.id !== person.homeHotel?.id)}
            covered={person.coverHotels.map((h) => h.id)}
          />
        </section>
      ) : null}

      {isSelf ? null : (
        <>
          <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="role-heading">
            <h2 id="role-heading" className="text-[1.0625rem] font-semibold">
              {t('roleTitle')}
            </h2>
            <RoleForm person={{ id: person.id, role: person.role }} />
          </section>

          <section className="ir-card flex flex-col gap-4 p-4" aria-labelledby="access-heading">
            <h2 id="access-heading" className="text-[1.0625rem] font-semibold">
              {t('accessTitle')}
            </h2>
            {/* Only a rep has a PIN. The boss signs in with a one-time code
                and has none by design (§21), so there is nothing here to
                re-issue for an admin row — and reissueRepPin() refuses one
                anyway rather than trusting this to be the only guard. */}
            {person.role === 'rep' ? (
              <>
                <ReissuePinForm person={{ id: person.id, full_name: person.full_name }} />
                <hr className="border-line" />
              </>
            ) : null}

            {person.active ? (
              <RemoveAccessForm
                person={{ id: person.id, full_name: person.full_name || person.email || '' }}
              />
            ) : (
              <RestoreAccessForm person={{ id: person.id }} />
            )}
          </section>
        </>
      )}
    </div>
  )
}
