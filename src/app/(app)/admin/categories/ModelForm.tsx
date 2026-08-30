'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { createModel, updateModel, type FormState } from './actions'
import type { CarModelRow, CategoryRow } from '@/lib/supabase/database.types'

export function ModelForm({
  model, categories, onDone,
}: {
  model?: CarModelRow
  categories: CategoryRow[]
  onDone?: () => void
}) {
  const t = useTranslations('admin.models')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const action = model ? updateModel : createModel
  const [state, formAction] = useActionState<FormState, FormData>(action, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {model ? <input type="hidden" name="id" value={model.id} /> : null}

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
          {te(state.error)}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field id="make" name="make" label={t('make')} defaultValue={model?.make} required maxLength={60} />
        <Field id="model" name="model" label={t('model')} defaultValue={model?.model} required maxLength={60} />
      </div>

      <div>
        <label className="ir-label" htmlFor="category_id">{t('category')}</label>
        <select
          id="category_id" name="category_id" className="ir-field" required
          defaultValue={model?.category_id ?? ''}
        >
          <option value="" disabled>{t('selectCategory')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.code} — {c.name_en}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="ir-label" htmlFor="transmission">{t('transmission')}</label>
          <select
            id="transmission" name="transmission" className="ir-field" required
            defaultValue={model?.transmission ?? 'manual'}
          >
            <option value="manual">{t('manual')}</option>
            <option value="automatic">{t('automatic')}</option>
          </select>
        </div>
        <div>
          <label className="ir-label" htmlFor="fuel_type">{t('fuelType')}</label>
          <select
            id="fuel_type" name="fuel_type" className="ir-field" required
            defaultValue={model?.fuel_type ?? 'petrol'}
          >
            <option value="petrol">{t('petrol')}</option>
            <option value="diesel">{t('diesel')}</option>
            <option value="hybrid">{t('hybrid')}</option>
            <option value="electric">{t('electric')}</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field id="seats" name="seats" type="number" label={t('seats')} defaultValue={model?.seats ?? 5} required min={1} max={9} />
        <Field id="doors" name="doors" type="number" label={t('doors')} defaultValue={model?.doors ?? 5} required min={1} max={6} />
      </div>

      <div className="grid grid-cols-2 gap-3 items-end">
        <Field
          id="tank_litres" name="tank_litres" type="number" step="0.1" label={t('tankLitres')}
          hint={t('tankLitresHint')} defaultValue={model?.tank_litres ?? undefined} min={0.1} max={999.9}
        />
        <label className="flex min-h-12 items-center gap-2.5 text-[1.0625rem] text-ink">
          <input
            type="checkbox" name="aircon" defaultChecked={model?.aircon ?? true}
            className="size-5 rounded border-line-strong"
          />
          {t('aircon')}
        </label>
      </div>

      <div className="flex gap-3">
        <SubmitButton label={model ? tc('save') : t('add')} />
        {onDone ? (
          <button type="button" onClick={onDone} className="ir-btn-quiet">{tc('cancel')}</button>
        ) : null}
      </div>
    </form>
  )
}
