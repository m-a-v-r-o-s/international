import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { loadHandoverContext } from '@/lib/handover/load'
import { DamageDiagram } from '../DamageDiagram'
import { FuelSlider } from '../FuelSlider'
import { ConfirmTransition } from '../ConfirmTransition'
import { StepNav, type StepState } from '../StepNav'
import { saveFuelIn, completeReturn } from './actions'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('returnFlow')
  return { title: t('title') }
}

const STEPS = ['fuel', 'damage', 'confirm'] as const
type Step = (typeof STEPS)[number]

/**
 * R5 · Return flow (docs/04-SCREENS.md).
 *
 * Fuel in, damage, confirm. Two things a rep does NOT do here, and the screen
 * says so out loud rather than leaving it to training: a fuel shortfall and
 * any new damage are recorded and flagged, never priced, never argued and
 * never collected (docs/01-DECISIONS.md §14). The rep's whole job is the
 * evidence; the boss decides the amount from A6.
 *
 * Confirming moves the rental to `returned`, which drops it out of the
 * exclusion constraint's predicate and so out of availability() — an early
 * return reopens the remaining dates the moment it is processed (§4), while
 * the price stays exactly what it was, because an early return earns no
 * refund.
 */
export default async function ReturnPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const staff = await requireUnlocked()
  const { id } = await params
  const query = await searchParams
  const t = await getTranslations('returnFlow')
  const th = await getTranslations('handover')
  const tb = await getTranslations('bookingDetail')
  const supabase = await supabaseServer()

  const ctx = await loadHandoverContext(supabase, id, staff.id)
  if (!ctx) notFound()

  const { booking, car, model, pickup, ret, marksByHandover } = ctx

  if (booking.status !== 'out') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
          {booking.status === 'returned' ? t('alreadyReturned') : t('notReturnable')}
        </p>
        <Link href={`/bookings/${booking.id}`} className="ir-btn-quiet">{tb('title')}</Link>
      </div>
    )
  }

  const carried = pickup ? marksByHandover.get(pickup.id) ?? [] : []
  const fresh = ret ? marksByHandover.get(ret.id) ?? [] : []

  const fuelOut = pickup?.fuel_eighths ?? null
  const fuelIn = ret?.fuel_eighths ?? null
  const shortfall = fuelOut !== null && fuelIn !== null ? fuelOut - fuelIn : 0

  const reachable: Record<Step, boolean> = {
    fuel: true,
    damage: ret !== null,
    confirm: ret !== null,
  }
  const done: Record<Step, boolean> = {
    fuel: ret !== null && ret.fuel_eighths !== null,
    damage: ret !== null,
    confirm: false,
  }

  const requested = (STEPS as readonly string[]).includes(query.step ?? '') ? (query.step as Step) : 'fuel'
  const step: Step = reachable[requested] ? requested : 'fuel'

  const steps: StepState[] = STEPS.map((key) => ({
    key,
    label: t(`step.${key}`),
    href: `/bookings/${booking.id}/return?step=${key}`,
    current: key === step,
    done: done[key],
    reachable: reachable[key],
  }))

  const nextHref = (from: Step) => {
    const next = STEPS[STEPS.indexOf(from) + 1]
    return next ? `/bookings/${booking.id}/return?step=${next}` : `/bookings/${booking.id}`
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/bookings/${booking.id}`} className="text-[0.9375rem] text-brand underline underline-offset-2">
          ← {booking.ref}
        </Link>
        <h1 className="mt-1 text-[1.75rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="text-ink-soft">
          {booking.cust_first} {booking.cust_last} · {car?.plate ?? '—'}
          {model ? ` · ${model.make} ${model.model}` : ''}
        </p>
      </div>

      <StepNav steps={steps} label={t('stepsLabel')} doneLabel={t('stepDone')} />

      {step === 'fuel' ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[1.25rem] font-semibold">{t('step.fuel')}</h2>
          <p className="ir-notice border-line bg-canvas">
            {t('fuelOutWas', {
              level: fuelOut !== null ? th('eighths', { n: fuelOut }) : '—',
            })}
          </p>
          <p className="text-ink-soft">{t('sameToSame')}</p>

          <div className="ir-card p-4">
            <FuelSlider
              bookingId={booking.id}
              action={saveFuelIn}
              defaultEighths={ret?.fuel_eighths ?? fuelOut}
              tankLitres={model?.tank_litres ?? null}
              label={th('fuelInLabel')}
              submitLabel={th('saveFuelIn')}
              savedLabel={th('fuelSaved')}
              comparedTo={fuelOut}
            />
          </div>

          {ret ? <Link href={nextHref('fuel')} className="ir-btn-primary">{t('toDamage')}</Link> : null}
        </section>
      ) : null}

      {step === 'damage' && ret ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[1.25rem] font-semibold">{t('step.damage')}</h2>
          <p className="text-ink-soft">{t('damageIntro')}</p>
          <p className="ir-notice border-warn bg-warn-tint text-warn">{t('damageNotPriced')}</p>
          <DamageDiagram handoverId={ret.id} marks={fresh} carriedForward={carried} tone="new" />
          <Link href={nextHref('damage')} className="ir-btn-primary">{t('toConfirm')}</Link>
        </section>
      ) : null}

      {step === 'confirm' && ret ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[1.25rem] font-semibold">{t('step.confirm')}</h2>

          <dl className="ir-card grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-[0.9375rem]">
            <div>
              <dt className="text-ink-soft">{th('fuelOutLabel')}</dt>
              <dd className="font-medium">{fuelOut !== null ? th('eighths', { n: fuelOut }) : '—'}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">{th('fuelInLabel')}</dt>
              <dd className="font-medium">{fuelIn !== null ? th('eighths', { n: fuelIn }) : '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink-soft">{t('newDamage')}</dt>
              <dd className="font-medium">{t('marksCount', { n: fresh.length })}</dd>
            </div>
          </dl>

          {shortfall > 0 ? (
            <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
              {t('willFlagFuel', { n: shortfall })}
            </p>
          ) : null}

          {fresh.length > 0 ? (
            <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
              {t('willFlagDamage', { n: fresh.length })}
            </p>
          ) : null}

          <p className="ir-notice border-line bg-canvas">{t('confirmHint')}</p>

          <ConfirmTransition
            bookingId={booking.id}
            action={completeReturn}
            label={t('confirmAction')}
            confirmMessage={t('confirmPrompt')}
          />
        </section>
      ) : null}
    </div>
  )
}
