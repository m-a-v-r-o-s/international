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

const STEPS = ['fuel', 'confirm'] as const
type Step = (typeof STEPS)[number]

/**
 * R5 · Return flow (docs/04-SCREENS.md).
 *
 * Fuel in, then confirm. It was three steps until 0030: the damage diagram in
 * the middle existed to raise a `new_damage` flag from taps on a car outline,
 * and damage found on a returning car is now REPORTED — in words and
 * photographs, from /incidents — which is how a cracked mirror is actually
 * described. The pickup keeps its diagram; that one is the agreed condition
 * the contract is signed against.
 *
 * The fuel shortfall is no longer flagged either, because it is no longer a
 * judgement: the database prices it on the transition at the owner's rate per
 * missing eighth (docs/01-DECISIONS.md §14). The screen says the figure out
 * loud before the rep confirms, so nobody learns of it after the guest has
 * driven off.
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
  const tp = await getTranslations('admin.bookings')
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

  const fuelOut = pickup?.fuel_eighths ?? null
  const fuelIn = ret?.fuel_eighths ?? null
  const shortfall = fuelOut !== null && fuelIn !== null ? Math.max(0, fuelOut - fuelIn) : 0

  // The same rate app.bookings_fuel_charge() will apply a moment later. Read
  // rather than assumed, so the number the rep reads out to the guest is the
  // number that lands on the booking.
  const { data: settings } = await supabase.from('app_settings')
    .select('fuel_charge_per_eighth').eq('id', 1).maybeSingle()
  const rate = settings?.fuel_charge_per_eighth ?? 10

  const reachable: Record<Step, boolean> = {
    fuel: true,
    confirm: ret !== null,
  }
  const done: Record<Step, boolean> = {
    fuel: ret !== null && ret.fuel_eighths !== null,
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

          {ret ? <Link href={nextHref('fuel')} className="ir-btn-primary">{t('toConfirm')}</Link> : null}
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
          </dl>

          {shortfall > 0 ? (
            <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
              {t('fuelCharge', { n: shortfall, amount: shortfall * rate })}
            </p>
          ) : null}

          <p className="ir-notice border-line bg-canvas">{t('confirmHint')}</p>
          <p className="ir-hint">{t('damageGoesToIncidents')}</p>

          <ConfirmTransition
            bookingId={booking.id}
            action={completeReturn}
            label={t('confirmAction')}
            confirmMessage={t('confirmPrompt')}
          >
            {/*
              Only when there is something to take. The amount is pre-filled
              with what the rule says and stays editable, because what the rep
              writes is what actually crossed the desk — a guest who argued it
              down is a fact for the boss to see, not an error to refuse.
            */}
            {shortfall > 0 ? (
              <fieldset className="ir-card flex flex-col gap-3 p-4">
                <legend className="px-1 text-[0.9375rem] font-semibold">
                  {t('fuelPaymentTitle')}
                </legend>

                <div>
                  <label className="ir-label" htmlFor="fuel_collected">
                    {t('fuelCollected')}
                  </label>
                  <input
                    id="fuel_collected" name="fuel_collected" type="number"
                    min={0} step={1} inputMode="numeric" className="ir-field"
                    defaultValue={shortfall * rate}
                  />
                  <p className="ir-hint">{t('fuelCollectedHint')}</p>
                </div>

                <div>
                  <label className="ir-label" htmlFor="fuel_pay_method">
                    {tp('payMethod')}
                  </label>
                  <select
                    id="fuel_pay_method" name="fuel_pay_method" className="ir-field"
                    defaultValue="cash"
                  >
                    <option value="cash">{tp('payMethodCash')}</option>
                    <option value="card">{tp('payMethodCard')}</option>
                    <option value="transfer">{tp('payMethodTransfer')}</option>
                  </select>
                </div>
              </fieldset>
            ) : null}
          </ConfirmTransition>
        </section>
      ) : null}
    </div>
  )
}
