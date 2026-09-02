'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { FormActions } from '@/components/FormActions'
import { createCategory, updateCategory, type FormState } from './actions'
import type { CategoryRow } from '@/lib/supabase/database.types'

export function CategoryForm({ category, onDone }: { category?: CategoryRow; onDone?: () => void }) {
  const t = useTranslations('admin.categories')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const action = category ? updateCategory : createCategory
  const [state, formAction] = useActionState<FormState, FormData>(action, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {category ? <input type="hidden" name="id" value={category.id} /> : null}

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
          {te(state.error)}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field id="code" name="code" label={t('code')} defaultValue={category?.code} required maxLength={4} />
        <Field
          id="sort_order" name="sort_order" type="number" label={t('sortOrder')}
          defaultValue={category?.sort_order} required min={0} max={999}
        />
      </div>

      <Field id="name_el" name="name_el" label={t('nameEl')} defaultValue={category?.name_el} required maxLength={80} />
      <Field id="name_en" name="name_en" label={t('nameEn')} defaultValue={category?.name_en} required maxLength={80} />

      <div className="grid grid-cols-2 gap-3">
        <Field
          id="min_driver_age" name="min_driver_age" type="number" label={t('minAge')}
          hint={t('minAgeHint')} defaultValue={category?.min_driver_age ?? 21} required min={16} max={99}
        />
        <Field
          id="min_licence_years" name="min_licence_years" type="number" label={t('minLicenceYears')}
          defaultValue={category?.min_licence_years ?? 1} required min={0} max={20}
        />
      </div>

      <FormActions
        label={category ? tc('save') : t('add')}
        requireChanges={Boolean(category)}
        saved={state && !state.error}
        onCancel={onDone}
      />
    </form>
  )
}
