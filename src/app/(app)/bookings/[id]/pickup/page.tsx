import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { signBookingFiles, signBookingFile } from '@/lib/storage/booking-files'
import { loadContractSource } from '@/lib/contract/load'
import { mailConfigured } from '@/lib/email/mailer'
import { athensDateTime } from '@/lib/contract/data'
import { loadHandoverContext, checkDriverEligibility } from '@/lib/handover/load'
import { formatEuros } from '@/lib/money'
import { DamageDiagram } from '../DamageDiagram'
import { FuelSlider } from '../FuelSlider'
import { ConfirmTransition } from '../ConfirmTransition'
import { StepNav, type StepState } from '../StepNav'
import { findCustomerByPhone } from '@/lib/customers/lookup'
import { DriverForm } from './DriverForm'
import { ReturningGuest } from './ReturningGuest'
import { LicenceCapture, type StoredLicenceImages } from './LicenceCapture'
import { SignaturePad } from './SignaturePad'
import { ContractCopyForm } from './ContractCopyForm'
import { PaymentForm } from './PaymentForm'
import { saveFuelOut, completePickup } from './actions'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pickup')
  return { title: t('title') }
}

// docs/04-SCREENS.md R4, in its own order: licence, eligibility, fuel, damage,
// agreement, copy, payment. `confirm` is the booked → out transition at the
// end of it.
const STEPS = [
  'drivers', 'eligibility', 'fuel', 'damage', 'agreement', 'copy', 'payment', 'confirm',
] as const
type Step = (typeof STEPS)[number]

/**
 * R4 · Pickup flow (docs/04-SCREENS.md).
 *
 * Licence capture and OCR, the eligibility gate, fuel out, the damage diagram,
 * payment, and the booked → out transition.
 *
 * The flow is sequential and resumable because every step writes its own rows
 * and the step you land on is read back off those rows — there is no wizard
 * state in the browser to lose when the phone locks with a guest waiting.
 *
 * Step 1 is a camera in front of a form, never instead of one
 * (docs/01-DECISIONS.md §10): a rep who photographs nothing fills the same
 * fields by hand and the pickup proceeds identically.
 *
 * The agreement and the copy are steps, not gates. Nothing in the database
 * requires a signed contract to reach `out` — the only hard block on that
 * transition is eligibility (§11) — and inventing a second one here would be
 * a rule the client never agreed to, on top of being unworkable while the
 * terms are still outstanding. The confirm step says whether an agreement is
 * on file so the rep can see what they are about to do.
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
  const tcs = await getTranslations('contractStep')
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

  // The database enforces this too (IR123) — this is only the friendly stop
  // before a rep works through five steps to be refused at the last one
  // (docs/01-DECISIONS.md, "Exception bookings wait for the boss").
  if (booking.exception_status === 'pending') {
    return (
      <FlowNotice
        title={t('title')}
        body={t('awaitingApproval')}
        href={`/bookings/${booking.id}`}
        linkLabel={tb('title')}
      />
    )
  }

  const eligibility = booking.category_id
    ? await checkDriverEligibility(supabase, booking.category_id, drivers, booking.start_date, booking.end_date)
    : []

  // The stored licence photos, behind short-lived signed URLs issued to this
  // rep and logged against them (docs/03-SECURITY.md §8). Two per driver, and
  // no public URL for any of them.
  const licenceUrls = await signBookingFiles(
    supabase,
    drivers.flatMap((d) => [d.front_image_path, d.back_image_path]),
    { actorId: staff.id })
  const storedFor = (index: number, driver: (typeof drivers)[number]): StoredLicenceImages => ({
    frontUrl: licenceUrls[index * 2] ?? null,
    backUrl: licenceUrls[index * 2 + 1] ?? null,
    hasFront: driver.front_image_path !== null,
    hasBack: driver.back_image_path !== null,
  })
  const indexOfDriver = new Map(drivers.map((d, i) => [d.id, i]))

  // The agreement's own state: whether the company details and terms exist at
  // all, and whether the guest has already signed.
  const contractSource = await loadContractSource(supabase, booking.id)
  const signed = contractSource?.contract ?? null
  const signedUrl = await signBookingFile(supabase, signed?.pdf_path, {
    actorId: staff.id, ttlSeconds: 300,
  })

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
    agreement: gateOpen && pickup !== null,
    copy: gateOpen && pickup !== null,
    payment: gateOpen && pickup !== null,
    confirm: gateOpen && pickup !== null,
  }
  const done: Record<Step, boolean> = {
    drivers: hasDrivers,
    eligibility: gateOpen,
    fuel: pickup?.fuel_eighths !== null && pickup !== null,
    damage: pickup !== null,
    agreement: signed !== null,
    copy: signed?.emailed_to !== null && signed !== null,
    payment: booking.pay_method !== null || booking.collected > 0,
    confirm: false,
  }

  const requested = (STEPS as readonly string[]).includes(query.step ?? '') ? (query.step as Step) : 'drivers'
  const step: Step = reachable[requested] ? requested : 'drivers'

  // ── The returning guest (docs/01-DECISIONS.md §25a) ──────────────────────
  // Asked here rather than from the browser, so the lookup runs under this
  // rep's own session and is subject to the rate limit and the audit line in
  // public.customer_by_phone() like every other call.
  //
  // The CONDITION is doing real work. It is not "look the guest up every time
  // this page renders": the pickup screen is reloaded after every step, and a
  // lookup per reload would burn the rep's hourly budget and fill the security
  // log with noise for no benefit. It asks once, while there is still
  // something to pre-fill — before the main driver exists, or while their
  // licence photos are still missing — and stops asking the moment the answer
  // could not change anything.
  const mainDriver = drivers.find((d) => d.is_main)
  const wantsLookup = step === 'drivers'
    && booking.cust_phone !== null
    && (mainDriver === undefined || mainDriver.front_image_path === null)

  const returning = wantsLookup
    ? (await findCustomerByPhone(supabase, booking.cust_phone as string))
    : null
  const match = returning?.ok ? returning.match : null

  // Whether this guest already agreed to stay in the ledger, so a re-signature
  // shows the box as they left it rather than silently resetting their choice.
  const { data: consentRow } = await supabase
    .from('customer_bookings').select('booking_id').eq('booking_id', booking.id).maybeSingle()
  const ledgerConsent = consentRow !== null

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

          {match ? (
            <ReturningGuest
              bookingId={booking.id}
              customerId={match.customerId}
              name={`${match.firstName ?? ''} ${match.lastName ?? ''}`.trim() || '—'}
              lastSeen={athensDateTime(match.lastSeenAt)}
              hasImages={match.hasLicenceImages}
              driverId={mainDriver?.id}
              imagesAlreadyOnBooking={mainDriver?.front_image_path !== null
                && mainDriver?.front_image_path !== undefined}
            />
          ) : null}

          <div className="ir-card flex flex-col gap-4 p-4">
            <h3 className="text-[1.0625rem] font-semibold">{t('mainDriver')}</h3>
            <LicenceCapture
              bookingId={booking.id}
              driverId={mainDriver?.id}
              isMain
              stored={mainDriver ? storedFor(indexOfDriver.get(mainDriver.id) ?? 0, mainDriver) : undefined}
            />
            {/*
              The booking's own values first, then the ledger's. A returning
              guest fills in the licence fields the booking never captured
              (§9 captures a name, a phone and a date of birth at booking
              time; the licence is only seen at pickup), and every one of them
              stays editable.
            */}
            <DriverForm
              bookingId={booking.id}
              isMain
              driver={mainDriver}
              defaults={{
                first_name: booking.cust_first ?? match?.firstName,
                last_name: booking.cust_last ?? match?.lastName,
                dob: booking.cust_dob ?? match?.dob,
                licence_number: match?.licenceNumber,
                licence_country: match?.licenceCountry,
                licence_issued_on: match?.licenceIssuedOn,
                licence_expires_on: match?.licenceExpiresOn,
              }}
            />
          </div>

          {drivers.filter((d) => !d.is_main).map((driver) => (
            <div key={driver.id} className="ir-card flex flex-col gap-4 p-4">
              <h3 className="text-[1.0625rem] font-semibold">{t('additionalDriver')}</h3>
              <LicenceCapture
                bookingId={booking.id}
                driverId={driver.id}
                isMain={false}
                stored={storedFor(indexOfDriver.get(driver.id) ?? 0, driver)}
              />
              <DriverForm bookingId={booking.id} isMain={false} driver={driver} />
            </div>
          ))}

          <div className="ir-card flex flex-col gap-4 p-4">
            <div>
              <h3 className="text-[1.0625rem] font-semibold">{t('addAdditionalDriver')}</h3>
              <p className="text-[0.875rem] text-ink-soft">{t('additionalFree')}</p>
            </div>
            <LicenceCapture bookingId={booking.id} isMain={false} />
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
          <Link href={nextHref('damage')} className="ir-btn-primary">{t('toAgreement')}</Link>
        </section>
      ) : null}

      {step === 'agreement' ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[1.25rem] font-semibold">{tcs('agreementTitle')}</h2>
          <p className="text-ink-soft">{tcs('agreementIntro')}</p>

          <div className="ir-card flex flex-col gap-2 p-4">
            <a
              href={`/bookings/${booking.id}/contract`}
              target="_blank"
              rel="noreferrer"
              className="ir-btn-quiet"
            >
              {tcs('preview')}
            </a>
            <p className="ir-hint">{tcs('previewHint')}</p>
          </div>

          {signed ? (
            <div className="ir-card flex flex-col gap-2 p-4">
              <h3 className="text-[1.0625rem] font-semibold text-ok">{tcs('signedTitle')}</h3>
              <p>
                {tcs('signedBy', {
                  name: signed.signer_name,
                  when: athensDateTime(signed.signed_at),
                })}
              </p>
              {signedUrl ? (
                <a href={signedUrl} target="_blank" rel="noreferrer" className="ir-btn-quiet">
                  {tcs('openSigned')}
                </a>
              ) : null}
            </div>
          ) : null}

          {contractSource && !contractSource.readiness.ready ? (
            <div className="ir-notice border-warn bg-warn-tint text-warn" role="status">
              <p className="font-semibold">{tcs('blockedTitle')}</p>
              <p className="mt-1">{tcs('blockedBody')}</p>
            </div>
          ) : (
            <div className="ir-card p-4">
              <h3 className="mb-3 text-[1.0625rem] font-semibold">
                {signed ? tcs('signAgain') : tcs('agreementTitle')}
              </h3>
              {signed ? <p className="mb-3 text-[0.875rem] text-ink-soft">{tcs('signAgainHint')}</p> : null}
              <SignaturePad
                bookingId={booking.id}
                defaultSignerName={`${booking.cust_first ?? ''} ${booking.cust_last ?? ''}`.trim()}
                ledgerConsent={ledgerConsent}
              />
            </div>
          )}

          <Link href={nextHref('agreement')} className="ir-btn-primary">{t('toCopy')}</Link>
          {contractSource && !contractSource.readiness.ready ? (
            <p className="ir-hint">{tcs('blockedSkip')}</p>
          ) : null}
        </section>
      ) : null}

      {step === 'copy' ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[1.25rem] font-semibold">{tcs('copyTitle')}</h2>
          <p className="text-ink-soft">{tcs('copyIntro')}</p>

          {signed ? (
            <div className="ir-card p-4">
              <ContractCopyForm
                bookingId={booking.id}
                contractId={signed.id}
                defaultEmail={contractSource?.custEmail ?? ''}
                alreadySentTo={signed.emailed_to}
                alreadySentAt={signed.emailed_at}
                skipHref={nextHref('copy')}
                mailConfigured={mailConfigured()}
              />
            </div>
          ) : (
            <>
              <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
                {tcs('notSignedYet')}
              </p>
              <Link href={nextHref('copy')} className="ir-btn-primary">{t('toPayment')}</Link>
            </>
          )}
        </section>
      ) : null}

      {step === 'payment' ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-[1.25rem] font-semibold">{t('step.payment')}</h2>
          <div className="ir-card p-4">
            <PaymentForm
              bookingId={booking.id}
              total={booking.total}
              collected={booking.collected}
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
              <dt className="text-ink-soft">{t('contractOnFile')}</dt>
              <dd className="font-medium">
                {signed ? t('contractSigned') : t('contractUnsigned')}
              </dd>
            </div>
            <div>
              <dt className="text-ink-soft">{t('collectedSummary')}</dt>
              <dd className="font-medium">
                {formatEuros(booking.collected)} · {booking.paid ? tb('paid') : tb('unpaid')}
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
