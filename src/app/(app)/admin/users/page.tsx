import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, getFormatter } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { Disclosure } from '@/components/Disclosure'
import { loadStaffWithHotels } from '@/lib/users/load'
import { CreateRepForm } from './StaffForms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.users')
  return { title: t('title') }
}

/**
 * A8 · Users & hotels — the users half.
 *
 * This is the pilot blocker. Until it exists the boss cannot create the two
 * reps the October test build is for, because nothing in the codebase inserts
 * into auth.users at all (docs/04-SCREENS.md A8, docs/05-BUILD-PLAN.md Phase 5).
 *
 * Each row shows the hotels a person is attached to, because that — not the
 * role — is what decides which bookings they can read
 * (docs/01-DECISIONS.md §8). A rep with no hotel is not a half-configured
 * account, it is an account that can see only what it created itself, so the
 * screen says so rather than leaving it to be discovered.
 */
export default async function AdminUsersPage() {
  await requireAdmin()
  const t = await getTranslations('admin.users')
  const th = await getTranslations('admin.hotels')
  const tr = await getTranslations('roles')
  const format = await getFormatter()
  const supabase = await supabaseServer()

  const { staff, hotels } = await loadStaffWithHotels(supabase)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
          <p className="text-ink-soft">{t('intro')}</p>
        </div>
        <p className="text-[0.9375rem] text-ink-soft">{t('count', { n: staff.length })}</p>
      </div>

      {hotels.length === 0 ? (
        <div className="ir-notice border-warn bg-warn-tint text-warn" role="status">
          <p>{t('noHotels')}</p>
          <Link href="/admin/hotels" className="mt-2 inline-block underline underline-offset-2">
            {t('goToHotels')}
          </Link>
        </div>
      ) : null}

      <Disclosure summary={`+ ${t('add')}`}>
        <CreateRepForm />
      </Disclosure>

      {staff.length === 0 ? (
        <p className="text-ink-soft">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {staff.map((person) => (
            <li key={person.id} className="ir-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/admin/users/${person.id}`}
                  className="min-h-11 py-1 text-[1.0625rem] font-semibold text-brand underline-offset-2 hover:underline"
                >
                  {person.full_name || person.email}
                </Link>
                <span className="flex items-center gap-2 text-[0.8125rem]">
                  <span className="rounded-full bg-ink-soft px-2 py-0.5 font-bold text-white">
                    {tr(person.role)}
                  </span>
                  {person.active ? null : (
                    <span className="rounded-full bg-danger px-2 py-0.5 font-bold text-white">
                      {t('inactiveBadge')}
                    </span>
                  )}
                </span>
              </div>

              <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[0.9375rem] sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-ink-soft">{t('email')}</dt>
                  <dd className="break-all">{person.email}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-ink-soft">{t('homeHotel')}</dt>
                  <dd>{person.homeHotel?.name ?? t('noHomeHotel')}</dd>
                </div>
                {person.coverHotels.length > 0 ? (
                  <div className="flex gap-2">
                    <dt className="text-ink-soft">{t('coverTitle')}</dt>
                    <dd>{person.coverHotels.map((h) => h.name).join(', ')}</dd>
                  </div>
                ) : null}
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
            </li>
          ))}
        </ul>
      )}

      <Link href="/admin/hotels" className="ir-btn-quiet">{th('title')}</Link>
    </div>
  )
}
