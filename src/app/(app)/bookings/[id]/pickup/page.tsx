import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { loadHandoverContext, checkDriverEligibility } from '@/lib/handover/load'
import { DamageDiagram } from '../DamageDiagram'
import { FuelSlider } from '../FuelSlider'
import { ConfirmTransition } from '../ConfirmTransition'
import { StepNav, type StepState } from '../StepNav'
import { DriverForm } from './DriverForm'
import { PaymentForm } from './PaymentForm'
import { saveFuelOut, completePickup } from './actions'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pickup')
  return { title: t('title') }
}

const STEPS = ['drivers', 'eligibility', 'fuel', 'damage', 'payment', 'confirm'] as const
type Step = (typeof STEPS)[number]

/**
 * R4 · Pickup flow (docs/04-SCREENS.md), minus what Phase 4 owns.
 *
 * Built this phase: driver entry, the eligibility gate, fuel out, the damage
 * diagram, payment, and the booked → out transition. NOT built here, by
 * design: licence OCR (step 1's camera), the bilingual agreement PDF and the
 * on-screen signature (steps 5–6). Those are Phase 4 in
 * docs/05-BUILD-PLAN.md and are not pulled forward; manual driver entry is a
 * first-class path either way (docs/01-DECISIONS.md §10), so nothing here is a
 * placeholder waiting on them.
 *
 * The flow is sequential and resumable because every step writes its own rows
 * and the step you land on is read back off those rows — there is no wizard
 * state in the browser to lose when the phone locks with a guest waiting.
 */
export default async function PickupPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const staff = await requireUnlocked()
  const { id } = await params
  const query = await searchParams
  const t = await getTranslations('pickup')
  const th = await getTranslations('handover')
  const tb = await getTranslations('bookingDetail')
  const supabase = await supabaseServer()

  const ctx = await loadHandoverContext(supabase, id, staff.id)
  if (!ctx) notFound()

  const { booking, car, model, drivers, pickup, marksByHandover } = ctx

  if (booking.status !== 'booked') {
    return (
      <FlowNotice
        title={t('title')}
        body={booking.status === 'out' ? t('alreadyOut') : t('notPickable')}
        href={`/bookings/${booking.id}`}
        linkLabel={tb('title')}
      />
    )
  }

  const eligibility = booking.category_id
    ? await checkDriverEligibility(supabase, booking.category_id, drivers, booking.start_date, booking.end_date)
    : []

  const overridden = booking.eligibility_override_at !== null
  const hasDrivers = drivers.length > 0
  const allEligible = hasDrivers && eligibility.every((e) => e.ok)
  const gateOpen = overridden || allEligible
  const marks = pickup ? marksByHandover.get(pickup.id) ?? [] : []

  const reachable: Record<Step, boolean> = {
    drivers: true,
    eligibility: true,
    fuel: gateOpen,
    damage: gateOpen && pickup !== null,
    payment: gateOpen && pickup !== null,
    confirm: gateOpen && pickup !== null,
  }
  const done: Record<Step, boolean> = {
    drivers: hasDrivers,
    eligibility: gateOpen,
    fuel: pickup?.fuel_eighths !== null && pickup !== null,
    damage: pickup !== null,
    payment: booking.pay_method !== null || booking.collected_cents > 0,
    confirm: false,
  }

  const requested = (STEPS as readonly string[]).includes(query.step ?? '') ? (query.step as Step) : 'drivers'
  const step: Step = reachable[requested] ? requested : 'drivers'

  const steps: StepState[] = STEPS.map((key) => ({
    key,
    label: t(`step.${key}`),
    href: `/bookings/${booking.id}/pickup?step=${key}`,
    current: key === step,
    done: done[key],
    reachable: reachable[key],
  }))

  const nextHref = (from: Step) => {
    const index = STEPS.indexOf(from)
    const next = STEPS[index + 1]
    return next ? `/bookings/${booking.id}/pickup?step=${next}` : `/bookings/${booking.id}`
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

      {step === 'drivers' ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[1.25rem] font-semibold">{t('step.drivers')}</h2>
          <p className="text-ink-soft">{t('driversIntro')}</p>

          <div className="ir-card p-4">
            <h3 className="mb-3 text-[1.0625rem] font-semibold">{t('mainDriver')}</h3>
            <DriverForm
              bookingId={booking.id}
              isMain
              driver={drivers.find((d) => d.is_main)}
              defaults={{
                first_name: booking.cust_first,
                last_name: booking.cust_last,
                dob: booking.cust_dob,
              }}
            />
          </div>

          {drivers.filter((d) => !d.is_main).map((driver) => (
            <div key={driver.id} className="ir-card p-4">
              <h3 className="mb-3 text-[1.0625rem] font-semibold">{t('additionalDriver')}</h3>
              <DriverForm bookingId={booking.id} isMain={false} driver={driver} />
            </div>
          ))}

          <div className="ir-card p-4">
            <h3 className="mb-1 text-[1.0625rem] font-semibold">{t('addAdditionalDriver')}</h3>
            <p className="mb-3 text-[0.875rem] text-ink-soft">{t('additionalFree')}</p>
            <DriverForm bookingId={booking.id} isMain={false} />
          </div>

          <Link href={nextHref('drivers')} className="ir-btn-primary">{t('toEligibility')}</Link>
        </section>
      ) : null}

      {step === 'eligibility' ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[1.25rem] font-semibold">{t('step.eligibility')}</h2>

          {!hasDrivers ? (
            <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{t('noDrivers')}</p>
          ) : null}

          <ul className="flex flex-col gap-3">
            {eligibility.map(({ driver, ok, failures }) => (
              <li key={driver.id} className="ir-card p-4">
                <p className="font-semibold">
                  {driver.first_name} {driver.last_name}
                  {driver.is_main ? '' : ` · ${t('additionalDriver')}`}
                </p>
                {ok ? (
                  <p className="mt-2 font-medium text-ok">✓ {t('eligible')}</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1">
                    {failures.map((code) => (
                      <li key={code} className="font-medium text-danger">
                        <span aria-hidden="true">✕ </span>
                        <EligibilityReason code={code} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {overridden && !allEligible ? (
            <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">{t('overrideRecorded')}</p>
          ) : null}

          {gateOpen ? (
            <Link href={nextHref('eligibility')} className="ir-btn-primary">{t('toFuel')}</Link>
          ) : (
            <div className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
              <p className="font-semibold">{t('blockedTitle')}</p>
              <p className="mt-1">{t('blockedBody')}</p>
              <p className="mt-2">{t('overrideAsk', { ref: booking.ref })}</p>
            </div>
          )}
        </section>
      ) : null}

      {step === 'fuel' ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[1.25rem] font-semibold">{t('step.fuel')}</h2>
          <div className="ir-card p-4">
            <FuelSlider
              bookingId={booking.id}
              action={saveFuelOut}
              defaultEighths={pickup?.fuel_eighths ?? null}
              tankLitres={model?.tank_litres ?? null}
              label={th('fuelOutLabel')}
              submitLabel={th('saveFuelOut')}
              savedLabel={th('fuelSaved')}
            />
          </div>
          {pickup ? <Link href={nextHref('fuel')} className="ir-btn-primary">{t('toDamage')}</Link> : null}
        </section>
      ) : null}

      {step === 'damage' && pickup ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[1.25rem] font-semibold">{t('step.damage')}</h2>
          <p className="text-ink-soft">{t('damageIntro')}</p>
          <DamageDiagram handoverId={pickup.id} marks={marks} tone="existing" />
          <Link href={nextHref('damage')} className="ir-btn-primary">{t('toPayment')}</Link>
        </section>
      ) : null}

      {step === 'payment' ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[1.25rem] font-semibold">{t('step.payment')}</h2>
          <div className="ir-card p-4">
            <PaymentForm
              bookingId={booking.id}
              totalCents={booking.total_cents}
              collectedCents={booking.collected_cents}
              payMethod={booking.pay_method}
              paid={booking.paid}
            />
          </div>
          <Link href={nextHref('payment')} className="ir-btn-primary">{t('toConfirm')}</Link>
        </section>
      ) : null}

      {step === 'confirm' && pickup ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[1.25rem] font-semibold">{t('step.confirm')}</h2>

          <dl className="ir-card grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-[0.9375rem]">
            <div>
              <dt className="text-ink-soft">{t('step.drivers')}</dt>
              <dd className="font-medium">{drivers.map((d) => `${d.first_name} ${d.last_name}`).join(', ') || '—'}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">{th('fuelOutLabel')}</dt>
              <dd className="font-medium">
                {pickup.fuel_eighths !== null ? th('eighths', { n: pickup.fuel_eighths }) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-soft">{t('step.damage')}</dt>
              <dd className="font-medium">{t('marksRecorded', { n: marks.length })}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">{t('collectedSummary')}</dt>
              <dd className="font-medium">
                €{(booking.collected_cents / 100).toFixed(2)} · {booking.paid ? tb('paid') : tb('unpaid')}
              </dd>
            </div>
          </dl>

          <p className="ir-notice border-line bg-canvas">{t('confirmHint')}</p>

          <ConfirmTransition
            bookingId={booking.id}
            action={completePickup}
            label={t('confirmAction')}
            confirmMessage={t('confirmPrompt')}
          />
        </section>
      ) : null}
    </div>
  )
}

async function EligibilityReason({ code }: { code: string }) {
  const t = await getTranslations('eligibility')
  const known = ['age', 'licence_held', 'licence_expired', 'dob_missing',
                 'licence_issue_date_missing', 'licence_expiry_missing']
  const te = await getTranslations('errors')
  return <>{known.includes(code) ? t(code) : te('unknown')}</>
}

async function FlowNotice({
  title, body, href, linkLabel,
}: {
  title: string; body: string; href: string; linkLabel: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{title}</h1>
      <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">{body}</p>
      <Link href={href} className="ir-btn-quiet">{linkLabel}</Link>
    </div>
  )
}
