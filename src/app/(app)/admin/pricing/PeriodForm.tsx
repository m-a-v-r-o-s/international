'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { FormActions } from '@/components/FormActions'
import {
  createPeriod, updatePeriod, deletePeriod, adjustPeriodPrices, addPeriodRange, deletePeriodRange,
  type FormState,
} from './actions'
import type { Database } from '@/lib/supabase/database.types'

type PeriodRow = Database['public']['Tables']['pricing_periods']['Row']
type RangeRow = Database['public']['Tables']['pricing_period_ranges']['Row']

export function PeriodForm({ period, onDone }: { period?: PeriodRow; onDone?: () => void }) {
  const t = useTranslations('admin.pricing')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const action = period ? updatePeriod : createPeriod
  const [state, formAction] = useActionState<FormState, FormData>(action, undefined)

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

        <FormActions
          label={period ? tc('save') : t('addPeriod')}
          requireChanges={Boolean(period)}
          saved={state && !state.error}
          onCancel={onDone}
        />
      </form>
    </div>
  )
}

/**
 * Deleting a sheet takes its prices and dates with it. A sheet that already
 * priced a booking is refused by the bookings FK and shows `inUse`.
 */
export function DeletePeriodForm({ periodId }: { periodId: string }) {
  const t = useTranslations('admin.pricing')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<FormState, FormData>(deletePeriod, undefined)

  return (
    <form
      action={formAction}
      className="flex flex-col items-end gap-2"
      onSubmit={(e) => { if (!confirm(t('deletePeriodConfirm'))) e.preventDefault() }}
    >
      <input type="hidden" name="id" value={periodId} />
      <SubmitButton label={t('deletePeriod')} variant="danger" />
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}
    </form>
  )
}

/** "+€5 on everything" for one sheet. Negative lowers. */
export function AdjustPricesForm({ periodId }: { periodId: string }) {
  const t = useTranslations('admin.pricing')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<FormState, FormData>(adjustPeriodPrices, undefined)

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        const delta = Number(new FormData(e.currentTarget).get('delta'))
        if (!confirm(t('adjustConfirm', { delta }))) e.preventDefault()
      }}
    >
      <input type="hidden" name="period_id" value={periodId} />
      <p className="text-[0.875rem] text-ink-soft">{t('adjustHint')}</p>
      <Field
        id={`delta-${periodId}`} name="delta" type="number" label={t('adjustLabel')}
        required min={-1000} max={1000} step={1}
      />
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}
      <SubmitButton label={t('adjustApply')} variant="quiet" />
    </form>
  )
}

/**
 * When a sheet applies: any number of stretches, each removable on its own.
 * No stretches means a draft that never prices a booking.
 */
export function PeriodRanges({ periodId, ranges }: { periodId: string; ranges: RangeRow[] }) {
  const t = useTranslations('admin.pricing')
  const te = useTranslations('errors')
  const [state, addAction] = useActionState<FormState, FormData>(addPeriodRange, undefined)
  const [deleteState, deleteAction] = useActionState<FormState, FormData>(deletePeriodRange, undefined)

  return (
    <div className="flex flex-col gap-3">
      {ranges.length === 0 ? (
        <p className="ir-notice border-warn bg-warn-tint text-warn">{t('undated')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ranges.map((range) => (
            <li key={range.id} className="flex items-center justify-between gap-3">
              <span>{range.start_date} → {range.end_date}</span>
              <form action={deleteAction} onSubmit={(e) => { if (!confirm(t('deleteRangeConfirm'))) e.preventDefault() }}>
                <input type="hidden" name="id" value={range.id} />
                <SubmitButton label={t('deleteRange')} variant="danger" />
              </form>
            </li>
          ))}
        </ul>
      )}
      {deleteState?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(deleteState.error)}</p>
      ) : null}

      <form action={addAction} className="flex flex-col gap-3">
        <input type="hidden" name="period_id" value={periodId} />
        <div className="grid grid-cols-2 gap-3">
          <Field id={`start-${periodId}`} name="start_date" type="date" label={t('start')} required />
          <Field id={`end-${periodId}`} name="end_date" type="date" label={t('end')} required />
        </div>
        {state?.error ? (
          <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
        ) : null}
        <SubmitButton label={t('addRange')} variant="quiet" />
      </form>
    </div>
  )
}
