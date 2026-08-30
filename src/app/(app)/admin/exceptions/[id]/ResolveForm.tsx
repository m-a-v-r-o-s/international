'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { resolveException, type FormState } from '../actions'

/**
 * A6 · Set the charge and close the item.
 *
 * Euros in, integer cents out, converted at this boundary and nowhere else —
 * the same as A4's price grid and A5's price amendment. An EMPTY amount is
 * kept empty rather than turned into 0: "seen, nothing to charge" and "charged
 * zero euros" read the same on a screen and differently on a record.
 */
export function ResolveForm({
  exceptionId, chargeCents, resolution, resolvedAt,
}: {
  exceptionId: string
  chargeCents: number | null
  resolution: string | null
  resolvedAt: string | null
}) {
  const t = useTranslations('admin.exceptions')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<FormState, FormData>(async (prev, formData) => {
    const euros = String(formData.get('charge_euros') ?? '').trim()
    formData.set('charge_cents', euros === '' ? '' : String(Math.round(Number.parseFloat(euros) * 100)))
    return resolveException(prev, formData)
  }, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={exceptionId} />

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}

      <Field
        id="charge_euros" name="charge_euros" type="number" min={0} step={0.01} inputMode="decimal"
        label={t('chargeLabel')} hint={t('chargeHint')}
        defaultValue={chargeCents !== null ? (chargeCents / 100).toFixed(2) : ''}
      />

      <div>
        <label className="ir-label" htmlFor="resolution">{t('resolutionLabel')}</label>
        <textarea
          id="resolution" name="resolution" className="ir-field min-h-24" rows={3} maxLength={2000}
          defaultValue={resolution ?? ''}
        />
        <p className="ir-hint">{t('resolutionHint')}</p>
      </div>

      <SubmitButton label={resolvedAt ? t('updateAction') : t('closeAction')} />
      {state?.saved ? <p className="text-[0.875rem] text-ok" role="status">{t('saved')}</p> : null}
    </form>
  )
}
