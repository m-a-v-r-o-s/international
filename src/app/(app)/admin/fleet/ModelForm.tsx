'use client'

import { useActionState, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { FormActions } from '@/components/FormActions'
import { categoryName } from '@/lib/fleet/categories'
import { createModel, updateModel, type ModelState } from './model-actions'
import type { CarModelRow, CategoryRow } from '@/lib/supabase/database.types'

/**
 * Add or edit one car model, on the fleet screen beside its plates.
 *
 * Mandatory: make, model, group, gearbox, seats and — for a NEW model — the
 * photo. Everything else is a spec the boss may not have to hand when the car
 * arrives on the lot, and a model that cannot be saved until someone looks up
 * its tank size is a model that gets added to the fleet as a sticky note.
 *
 * The photo is required on create and optional on edit, which is not an
 * inconsistency: on edit, an empty file input means "leave the picture alone",
 * and the seeded placeholder models predate the bucket and must stay editable.
 */
export function ModelForm({
  model, categories, photoUrl, onDone,
}: {
  model?: CarModelRow
  categories: CategoryRow[]
  /** The public URL of the photo this model already has, if any. */
  photoUrl?: string | null
  onDone?: () => void
}) {
  const t = useTranslations('admin.models')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const locale = useLocale()
  const action = model ? updateModel : createModel
  const [state, formAction] = useActionState<ModelState, FormData>(action, undefined)

  // A new model cannot be saved without a picture, and the button says so
  // before the round trip rather than after it. The server re-checks: this is
  // the hint, never the control.
  const [hasPhoto, setHasPhoto] = useState(false)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {model ? <input type="hidden" name="id" value={model.id} /> : null}

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
          {te(state.error)}
        </p>
      ) : null}
      {state?.photoError ? (
        <p className="ir-notice border-warn bg-warn-tint text-warn" role="alert">
          {t('photoFailed')} {te(state.photoError)}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field id={`make-${model?.id ?? 'new'}`} name="make" label={t('make')}
               defaultValue={model?.make} required maxLength={60} />
        <Field id={`model-${model?.id ?? 'new'}`} name="model" label={t('model')}
               defaultValue={model?.model} required maxLength={60} />
      </div>

      <div>
        <label className="ir-label" htmlFor={`category_id-${model?.id ?? 'new'}`}>{t('category')}</label>
        <select
          id={`category_id-${model?.id ?? 'new'}`} name="category_id" className="ir-field" required
          defaultValue={model?.category_id ?? ''}
        >
          <option value="" disabled>{t('selectCategory')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.code} — {categoryName(c, locale)}</option>
          ))}
        </select>
      </div>

      {/* The picture. On a phone this opens the camera roll; the accept list is
          a convenience for the picker, and the bytes are sniffed server-side
          regardless of what the browser calls the file. */}
      <div>
        <label className="ir-label" htmlFor={`photo-${model?.id ?? 'new'}`}>
          {model ? t('photoReplace') : t('photo')}
        </label>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={t('photoAlt', { make: model?.make ?? '', model: model?.model ?? '' })}
            className="mb-2 aspect-[4/3] w-32 rounded-field border border-line object-cover"
          />
        ) : null}
        <input
          id={`photo-${model?.id ?? 'new'}`} name="photo" type="file"
          accept="image/jpeg,image/png,image/webp"
          required={!model}
          onChange={(e) => setHasPhoto(Boolean(e.currentTarget.files?.length))}
          className="ir-field !py-2.5 file:mr-3 file:rounded-field file:border-0 file:bg-brand
                     file:px-3 file:py-2 file:text-[0.9375rem] file:font-semibold file:text-brand-ink"
        />
        <p className="ir-hint">{model ? t('photoHint') : `${t('photoRequired')} ${t('photoHint')}`}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="ir-label" htmlFor={`transmission-${model?.id ?? 'new'}`}>{t('transmission')}</label>
          <select
            id={`transmission-${model?.id ?? 'new'}`} name="transmission" className="ir-field" required
            defaultValue={model?.transmission ?? 'manual'}
          >
            <option value="manual">{t('manual')}</option>
            <option value="automatic">{t('automatic')}</option>
          </select>
        </div>
        <div>
          <label className="ir-label" htmlFor={`fuel_type-${model?.id ?? 'new'}`}>{t('fuelType')}</label>
          <select
            id={`fuel_type-${model?.id ?? 'new'}`} name="fuel_type" className="ir-field" required
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
        <Field id={`seats-${model?.id ?? 'new'}`} name="seats" type="number" label={t('seats')}
               defaultValue={model?.seats ?? 5} required min={1} max={9} />
        <Field id={`doors-${model?.id ?? 'new'}`} name="doors" type="number" label={t('doors')}
               defaultValue={model?.doors ?? 5} min={1} max={6} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field id={`engine_cc-${model?.id ?? 'new'}`} name="engine_cc" type="number" label={t('engineCc')}
               hint={t('engineCcHint')} defaultValue={model?.engine_cc ?? undefined} min={50} max={9999} />
        <Field id={`horsepower-${model?.id ?? 'new'}`} name="horsepower" type="number" label={t('horsepower')}
               defaultValue={model?.horsepower ?? undefined} min={1} max={2000} />
      </div>

      <Field
        id={`tank_litres-${model?.id ?? 'new'}`} name="tank_litres" type="number" step="0.1"
        label={t('tankLitres')} hint={t('tankLitresHint')}
        defaultValue={model?.tank_litres ?? undefined} min={0.1} max={999.9}
      />

      <FormActions
        label={model ? tc('save') : t('add')}
        requireChanges={Boolean(model)}
        disabled={!model && !hasPhoto}
        saved={state?.saved}
        onCancel={onDone}
      />
    </form>
  )
}
