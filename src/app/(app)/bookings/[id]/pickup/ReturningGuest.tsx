'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { reuseCustomerLicence, type ReuseState } from './customer-actions'

/**
 * "We have had this guest before" — what a phone match looks like on the
 * pickup screen (docs/01-DECISIONS.md §25a).
 *
 * The owner chose the fastest of the three matching rules: an exact phone
 * number fills the form in immediately, with no confirmation step. So the
 * honesty has to live somewhere else, and it lives here — the rep is TOLD that
 * the fields below were filled from a previous rental, and told whose and
 * when, before they save anything. A form that silently pre-fills from another
 * booking is how a wrong number becomes a stranger's licence number on a
 * rental agreement; a form that says "these came from Anna Visitor, last
 * rented 12 months ago" is one the rep can disagree with at a glance.
 *
 * The licence PHOTOGRAPHS are the one thing that does not happen on its own.
 * See customer-actions.ts for why that asymmetry is deliberate.
 */
export function ReturningGuest({
  bookingId, customerId, name, lastSeen, hasImages, driverId, imagesAlreadyOnBooking,
}: {
  bookingId: string
  customerId: string
  name: string
  lastSeen: string
  hasImages: boolean
  /** Undefined until the rep has saved the main driver row. */
  driverId?: string
  imagesAlreadyOnBooking: boolean
}) {
  const t = useTranslations('pickup')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<ReuseState, FormData>(
    reuseCustomerLicence, undefined)

  return (
    <div className="ir-notice border-brand bg-brand-tint flex flex-col gap-3" role="status">
      <div>
        <p className="font-semibold">{t('returningTitle')}</p>
        <p className="mt-1">{t('returningBody', { name, when: lastSeen })}</p>
      </div>

      {hasImages && !imagesAlreadyOnBooking ? (
        driverId ? (
          <form action={formAction} className="flex flex-col gap-2">
            <input type="hidden" name="booking_id" value={bookingId} />
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="driver_id" value={driverId} />

            {state?.error ? (
              <p className="font-medium text-danger" role="alert">
                {state.error === 'noImages' ? t('reuseGone') : te(state.error)}
              </p>
            ) : null}
            {state?.saved ? (
              <p className="font-medium text-ok">{t('reuseDone', { n: state.saved })}</p>
            ) : null}

            <SubmitButton label={t('reuseImages')} variant="quiet" />
            <p className="ir-hint">{t('reuseHint')}</p>
          </form>
        ) : (
          <p className="ir-hint">{t('reuseNeedsDriver')}</p>
        )
      ) : null}
    </div>
  )
}
