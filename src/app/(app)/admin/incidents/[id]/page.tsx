import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { signBookingFiles } from '@/lib/storage/booking-files'
import { ResolveForm } from './ResolveForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.incidents')
  return { title: t('title') }
}

/**
 * A6 · One incident, with the evidence beside it.
 *
 * `charge` and `resolution` are not in any client column grant, so they arrive
 * through admin_incident_detail(), which re-checks app.is_admin() itself.
 * Everything else on this page is what the rep sent: their own words, and the
 * photographs they took.
 *
 * The photos get short-lived signed URLs, issued through the boss's own
 * session and logged against him like every other issuance (§12) — there is no
 * public URL for these any more than for a licence image.
 */
export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireAdmin()
  const { id } = await params
  const t = await getTranslations('admin.incidents')
  const tb = await getTranslations('bookingDetail')
  const supabase = await supabaseServer()

  const { data: detailRows } = await supabase.rpc('admin_incident_detail', { p_id: id })
  const incident = detailRows?.[0]
  if (!incident) notFound()

  const [{ data: booking }, { data: raisedBy }, { data: photoRows }] = await Promise.all([
    supabase.from('bookings')
      .select('id, ref, car_id, cust_first, cust_last, start_date, end_date')
      .eq('id', incident.booking_id).maybeSingle(),
    incident.raised_by
      ? supabase.from('profiles').select('id, full_name').eq('id', incident.raised_by).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('incident_photos')
      .select('id, path, added_at').eq('incident_id', id).order('added_at'),
  ])

  const { data: car } = booking
    ? await supabase.from('cars').select('id, plate').eq('id', booking.car_id).maybeSingle()
    : { data: null }

  const photos = (photoRows ?? []) as { id: string; path: string }[]
  const urls = await signBookingFiles(supabase, photos.map((p) => p.path), { actorId: staff.id })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/incidents" className="text-[0.9375rem] text-brand underline underline-offset-2">
          ← {t('backToQueue')}
        </Link>
        <h1 className="mt-1 text-[1.75rem] font-bold tracking-tight">
          {booking?.ref ?? t('title')}
        </h1>
        <p className="text-ink-soft">
          {incident.resolved_at ? t('resolvedOn', { date: incident.resolved_at.slice(0, 10) }) : t('open')}
        </p>
      </div>

      <section className="ir-card p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[0.9375rem]">
          <div>
            <dt className="text-ink-soft">{t('booking')}</dt>
            <dd className="font-medium">
              {booking ? (
                <Link href={`/admin/bookings/${booking.id}`} className="text-brand underline underline-offset-2">
                  {booking.ref}
                </Link>
              ) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">{tb('guest')}</dt>
            <dd className="font-medium">
              {booking ? `${booking.cust_first ?? ''} ${booking.cust_last ?? ''}`.trim() : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">{tb('car')}</dt>
            <dd className="font-medium">{car?.plate ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{tb('dates')}</dt>
            <dd className="font-medium">{booking ? `${booking.start_date} → ${booking.end_date}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('raisedBy')}</dt>
            <dd className="font-medium">{raisedBy?.full_name ?? t('raisedBySystem')}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('raisedAt')}</dt>
            <dd className="font-medium">{incident.raised_at.slice(0, 10)}</dd>
          </div>
        </dl>

        <div className="mt-4 border-t border-line pt-3">
          <h2 className="mb-1 text-[0.9375rem] text-ink-soft">{t('note')}</h2>
          {incident.note ? (
            <p className="whitespace-pre-wrap text-[0.9375rem]">{incident.note}</p>
          ) : (
            <p className="text-[0.9375rem] text-ink-soft">{t('noNote')}</p>
          )}
        </div>
      </section>

      {photos.length > 0 ? (
        <section className="ir-card p-4">
          <h2 className="mb-3 text-[1.0625rem] font-semibold">
            {t('photoCount', { n: photos.length })}
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((photo, index) => {
              const url = urls[index]
              return (
                <li key={photo.id}>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={t('photoAlt', { n: index + 1 })}
                        className="aspect-square w-full rounded-field object-cover"
                      />
                    </a>
                  ) : (
                    <p className="ir-notice border-line bg-canvas text-[0.8125rem]">
                      {t('photoUnavailable')}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <section className="ir-card p-4">
        <h2 className="mb-1 text-[1.0625rem] font-semibold">{t('resolveTitle')}</h2>
        <p className="mb-3 text-[0.875rem] text-ink-soft">{t('resolveHint')}</p>
        <ResolveForm
          incidentId={incident.id}
          charge={incident.charge}
          resolution={incident.resolution}
          resolvedAt={incident.resolved_at}
        />
      </section>
    </div>
  )
}
