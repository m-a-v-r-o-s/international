'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { createPeriod, updatePeriod, deletePeriod, type FormState } from './actions'
import type { Database } from '@/lib/supabase/database.types'

type PeriodRow = Database['public']['Tables']['pricing_periods']['Row']

export function PeriodForm({ period, onDone }: { period?: PeriodRow; onDone?: () => void }) {
  const t = useTranslations('admin.pricing')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const action = period ? updatePeriod : createPeriod
  const [state, formAction] = useActionState<FormState, FormData>(action, undefined)
  const [deleteState, deleteAction] = useActionState<FormState, FormData>(deletePeriod, undefined)

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        {period ? <input type="hidden" name="id" value={period.id} /> : null}

        {state?.error ? (
          <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field id="name" name="name" label={t('periodName')} defaultValue={period?.name} required maxLength={60} />
          <Field
            id="season_year" name="season_year" type="number" label={t('seasonYear')}
            defaultValue={period?.season_year ?? new Date().getFullYear()} required min={2020} max={2100}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field id="start_date" name="start_date" type="date" label={t('start')} defaultValue={period?.start_date} required />
          <Field id="end_date" name="end_date" type="date" label={t('end')} defaultValue={period?.end_date} required />
        </div>

        <div className="flex gap-3">
          <SubmitButton label={period ? tc('save') : t('addPeriod')} />
          {onDone ? (
            <button type="button" onClick={onDone} className="ir-btn-quiet">{tc('cancel')}</button>
          ) : null}
        </div>
      </form>

      {period ? (
        <form
          action={deleteAction}
          className="border-t border-line pt-4"
          onSubmit={(e) => { if (!confirm(t('deletePeriodConfirm'))) e.preventDefault() }}
        >
          <input type="hidden" name="id" value={period.id} />
          {deleteState?.error ? (
            <p className="ir-notice border-danger bg-danger-tint text-danger mb-3" role="alert">
              {te(deleteState.error)}
            </p>
          ) : null}
          <SubmitButton label={t('deletePeriod')} variant="quiet" />
        </form>
      ) : null}
    </div>
  )
}
