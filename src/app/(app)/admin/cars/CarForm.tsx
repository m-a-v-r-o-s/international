'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { FormActions } from '@/components/FormActions'
import { createCar, updateCar, type FormState } from './actions'
import type { CarModelRow, CarRow } from '@/lib/supabase/database.types'

export function CarForm({
  car, models, onDone,
}: {
  car?: CarRow
  models: CarModelRow[]
  onDone?: () => void
}) {
  const t = useTranslations('admin.cars')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const action = car ? updateCar : createCar
  const [state, formAction] = useActionState<FormState, FormData>(action, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {car ? <input type="hidden" name="id" value={car.id} /> : null}

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
          {te(state.error)}
        </p>
      ) : null}

      <Field id="plate" name="plate" label={t('plate')} defaultValue={car?.plate} required maxLength={16} />

      <div>
        <label className="ir-label" htmlFor="model_id">{t('model')}</label>
        <select
          id="model_id" name="model_id" className="ir-field" required
          defaultValue={car?.model_id ?? ''}
        >
          <option value="" disabled>{t('selectModel')}</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.make} {m.model}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field id="year" name="year" type="number" label={t('year')} defaultValue={car?.year ?? undefined} min={1980} max={2100} />
        <Field id="colour" name="colour" label={t('colour')} defaultValue={car?.colour ?? undefined} maxLength={40} />
      </div>

      <FormActions
        label={car ? tc('save') : t('add')}
        requireChanges={Boolean(car)}
        saved={state && !state.error}
        onCancel={onDone}
      />
    </form>
  )
}
