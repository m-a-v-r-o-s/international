'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { FormActions } from '@/components/FormActions'
import { formatEuros } from '@/lib/money'
import { savePayment, type PickupState } from './actions'

/**
 * R4 step 7 — payment (docs/01-DECISIONS.md §15). Amount collected, method,
 * paid or not. No security deposit is taken and none is built.
 *
 * The price is shown here, read-only, and is not an input: a rep cannot
 * discount, override or negotiate it (§6), `total` is absent from their
 * column grant, and the guard trigger reverts it even if it were sent. What
 * they type is what the guest actually handed over — a different number.
 *
 * Whole euros, both sides — the input rejects a decimal outright rather than
 * rounding it away.
 */
export function PaymentForm({
  bookingId, total, collected, payMethod, paid,
}: {
  bookingId: string
  total: number | null
  collected: number
  payMethod: 'cash' | 'card' | 'transfer' | null
  paid: boolean
}) {
  const t = useTranslations('pickup')
  const tb = useTranslations('admin.bookings')
  const tc = useTranslations('common')
  const te = useTranslations('errors')

  const [state, formAction] = useActionState<PickupState, FormData>(savePayment, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="booking_id" value={bookingId} />

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}

      <p className="ir-notice border-line bg-canvas">
        {t('priceDue')}{' '}
        <span className="font-semibold text-brand">{formatEuros(total)}</span>
      </p>

      <Field
        id="collected" name="collected" type="number" min={0} step={1} inputMode="numeric"
        label={t('collected')} defaultValue={collected} required
      />

      <div>
        <label className="ir-label" htmlFor="pay_method">{tb('payMethod')}</label>
        <select id="pay_method" name="pay_method" className="ir-field" defaultValue={payMethod ?? ''}>
          <option value="">{t('noMethod')}</option>
          <option value="cash">{tb('payMethodCash')}</option>
          <option value="card">{tb('payMethodCard')}</option>
          <option value="transfer">{tb('payMethodTransfer')}</option>
        </select>
      </div>

      <div className="flex min-h-12 items-center gap-3">
        <input id="paid" name="paid" type="checkbox" defaultChecked={paid} className="size-6 accent-brand" />
        <label htmlFor="paid" className="text-[1.0625rem]">{t('paidInFull')}</label>
      </div>

      <FormActions label={tc('save')} variant="quiet" saved={state?.saved} />
      {state?.saved ? <p className="text-[0.875rem] text-ok" role="status">{t('paymentSaved')}</p> : null}
    </form>
  )
}
