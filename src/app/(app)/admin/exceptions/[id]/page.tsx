import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { loadHandoverContext } from '@/lib/handover/load'
import { ResolveForm } from './ResolveForm'
import { pointToZone } from '@/lib/damage/zones'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.exceptions')
  return { title: t('title') }
}

/**
 * A6 · One exception, with the evidence beside it.
 *
 * `charge_cents` and `resolution` are not in any client column grant, so they
 * arrive through admin_exception_detail(), which re-checks app.is_admin()
 * itself. Everything else on this page is the evidence the rep recorded — the
 * two fuel readings and the marks on the diagram — rendered here with
 * translated labels rather than left to the exception's stored `detail` line,
 * which is deliberately numbers and codes so that it reads the same in Greek
 * and English.
 */
export default async function ExceptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const t = await getTranslations('admin.exceptions')
  const th = await getTranslations('handover')
  const td = await getTranslations('damage')
  const tb = await getTranslations('bookingDetail')
  const supabase = await supabaseServer()

  const { data: detailRows } = await supabase.rpc('admin_exception_detail', { p_id: id })
  const exception = detailRows?.[0]
  if (!exception) notFound()

  const ctx = await loadHandoverContext(supabase, exception.booking_id)

  const { data: raisedBy } = exception.raised_by
    ? await supabase.from('profiles').select('id, full_name').eq('id', exception.raised_by).maybeSingle()
    : { data: null }

  const fuelOut = ctx?.pickup?.fuel_eighths ?? null
  const fuelIn = ctx?.ret?.fuel_eighths ?? null
  const newMarks = ctx?.ret ? ctx.marksByHandover.get(ctx.ret.id) ?? [] : []
  const oldMarks = ctx?.pickup ? ctx.marksByHandover.get(ctx.pickup.id) ?? [] : []

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/exceptions" className="text-[0.9375rem] text-brand underline underline-offset-2">
          ← {t('backToQueue')}
        </Link>
        <h1 className="mt-1 text-[1.75rem] font-bold tracking-tight">{t(`type.${exception.type}`)}</h1>
        <p className="text-ink-soft">
          {exception.resolved_at ? t('resolvedOn', { date: exception.resolved_at.slice(0, 10) }) : t('open')}
        </p>
      </div>

      <section className="ir-card p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[0.9375rem]">
          <div>
            <dt className="text-ink-soft">{t('booking')}</dt>
            <dd className="font-medium">
              {ctx ? (
                <Link href={`/admin/bookings/${ctx.booking.id}`} className="text-brand underline underline-offset-2">
                  {ctx.booking.ref}
                </Link>
              ) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">{tb('guest')}</dt>
            <dd className="font-medium">{ctx ? `${ctx.booking.cust_first ?? ''} ${ctx.booking.cust_last ?? ''}`.trim() : '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{tb('car')}</dt>
            <dd className="font-medium">{ctx?.car?.plate ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{tb('dates')}</dt>
            <dd className="font-medium">{ctx ? `${ctx.booking.start_date} → ${ctx.booking.end_date}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('raisedBy')}</dt>
            <dd className="font-medium">{raisedBy?.full_name ?? t('raisedBySystem')}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">{t('raisedAt')}</dt>
            <dd className="font-medium">{exception.raised_at.slice(0, 10)}</dd>
          </div>
        </dl>

        {exception.detail ? (
          <p className="mt-4 border-t border-line pt-3 text-[0.9375rem]">
            <span className="text-ink-soft">{t('detail')}: </span>{exception.detail}
          </p>
        ) : null}
      </section>

      {exception.type === 'fuel_short' ? (
        <section className="ir-card p-4">
          <h2 className="mb-3 text-[1.0625rem] font-semibold">{t('fuelEvidence')}</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[0.9375rem]">
            <div>
              <dt className="text-ink-soft">{th('fuelOutLabel')}</dt>
              <dd className="font-medium">{fuelOut !== null ? th('eighths', { n: fuelOut }) : '—'}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">{th('fuelInLabel')}</dt>
              <dd className="font-medium">{fuelIn !== null ? th('eighths', { n: fuelIn }) : '—'}</dd>
            </div>
            {ctx?.model?.tank_litres && fuelOut !== null && fuelIn !== null && fuelOut > fuelIn ? (
              <div className="col-span-2">
                <dt className="text-ink-soft">{t('shortBy')}</dt>
                <dd className="font-medium">
                  {th('eighths', { n: fuelOut - fuelIn })}
                  {' · '}
                  {th('litres', { n: ((ctx.model.tank_litres * (fuelOut - fuelIn)) / 8).toFixed(1) })}
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="ir-hint mt-3">{t('fuelJudgement')}</p>
        </section>
      ) : null}

      {exception.type === 'new_damage' ? (
        <section className="ir-card p-4">
          <h2 className="mb-3 text-[1.0625rem] font-semibold">{td('newTitle')}</h2>
          {newMarks.length === 0 ? (
            <p className="text-ink-soft">{td('noneNew')}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {newMarks.map((mark, index) => (
                <li key={mark.id} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 rounded-full bg-danger px-2 py-0.5 text-[0.75rem] font-bold text-white">
                    {index + 1}
                  </span>
                  <span className="text-[0.9375rem]">
                    {td(`view.${mark.view}`)} · {td(`zone.${pointToZone(mark.x, mark.y)}`)} · {td(`type.${mark.mark_type}`)}
                    {mark.note ? <span className="block text-ink-soft">{mark.note}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {oldMarks.length > 0 ? (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="mb-2 text-[0.9375rem] font-semibold text-ink-soft">{td('carriedTitle')}</h3>
              <ol className="flex flex-col gap-1 text-[0.875rem] text-ink-soft">
                {oldMarks.map((mark) => (
                  <li key={mark.id}>
                    {td(`view.${mark.view}`)} · {td(`zone.${pointToZone(mark.x, mark.y)}`)} · {td(`type.${mark.mark_type}`)}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="ir-card p-4">
        <h2 className="mb-1 text-[1.0625rem] font-semibold">{t('resolveTitle')}</h2>
        <p className="mb-3 text-[0.875rem] text-ink-soft">{t('resolveHint')}</p>
        <ResolveForm
          exceptionId={exception.id}
          chargeCents={exception.charge_cents}
          resolution={exception.resolution}
          resolvedAt={exception.resolved_at}
        />
      </section>
    </div>
  )
}
