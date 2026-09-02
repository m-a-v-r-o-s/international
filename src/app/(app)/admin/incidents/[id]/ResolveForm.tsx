'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { FormActions } from '@/components/FormActions'
import { resolveIncident, type FormState } from '../actions'

/**
 * A6 · Set the charge and close the item.
 *
 * Whole euros, no conversion needed at this boundary — the same as A4's price
 * grid and A5's price amendment. An EMPTY amount is kept empty rather than
 * turned into 0: "seen, nothing to charge" and "charged zero euros" read the
 * same on a screen and differently on a record.
 */
export function ResolveForm({
  incidentId, charge, resolution, resolvedAt,
}: {
  incidentId: string
  charge: number | null
  resolution: string | null
  resolvedAt: string | null
}) {
  const t = useTranslations('admin.incidents')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<FormState, FormData>(resolveIncident, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={incidentId} />

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}

      <Field
        id="charge" name="charge" type="number" min={0} step={1} inputMode="numeric"
        label={t('chargeLabel')} hint={t('chargeHint')}
        defaultValue={charge ?? ''}
      />

      <div>
        <label className="ir-label" htmlFor="resolution">{t('resolutionLabel')}</label>
        <textarea
          id="resolution" name="resolution" className="ir-field min-h-24" rows={3} maxLength={2000}
          defaultValue={resolution ?? ''}
        />
        <p className="ir-hint">{t('resolutionHint')}</p>
      </div>

      <FormActions
        label={resolvedAt ? t('updateAction') : t('closeAction')}
        requireChanges={Boolean(resolvedAt)}
        saved={state?.saved}
      />
      {state?.saved ? <p className="text-[0.875rem] text-ok" role="status">{t('saved')}</p> : null}
    </form>
  )
}
