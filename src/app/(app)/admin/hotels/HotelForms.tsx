'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { FormActions } from '@/components/FormActions'
import type { HotelRow } from '@/lib/supabase/database.types'
import {
  createHotel, deleteHotel, setHotelActive, updateHotel, type HotelFormState,
} from './actions'

function Notice({ state }: { state: HotelFormState }) {
  const t = useTranslations('admin.hotels')
  const te = useTranslations('errors')

  if (state?.error) {
    return (
      <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
        {te(state.error)}
      </p>
    )
  }
  if (state?.saved) {
    return <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">{t('saved')}</p>
  }
  return null
}

function Fields({ hotel }: { hotel?: HotelRow }) {
  const t = useTranslations('admin.hotels')
  const prefix = hotel ? `h-${hotel.id}-` : 'new-'

  return (
    <>
      <Field
        id={`${prefix}name`} name="name" label={t('name')}
        defaultValue={hotel?.name ?? ''} maxLength={160} required autoComplete="off"
      />
      <Field
        id={`${prefix}area`} name="area" label={t('area')} hint={t('areaHint')}
        defaultValue={hotel?.area ?? ''} maxLength={120} autoComplete="off"
      />
      <div>
        <label className="ir-label" htmlFor={`${prefix}address`}>{t('address')}</label>
        <textarea
          id={`${prefix}address`} name="address" className="ir-field" rows={2} maxLength={300}
          defaultValue={hotel?.address ?? ''}
        />
      </div>
      {/*
        §42 keeps the office an ordinary hotel row, with real reps and no
        special treatment in booking, pricing or RLS. This box is the one place
        it is told apart, and only for A13's benefit (§45): the yard sorts to
        the top of a destination list instead of hiding among forty hotel names.
      */}
      <div>
        <label className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
          <input
            type="checkbox" name="is_depot" className="size-5"
            defaultChecked={hotel?.is_depot ?? false}
          />
          {t('isDepot')}
        </label>
        <p className="ir-hint">{t('isDepotHint')}</p>
      </div>
    </>
  )
}

export function CreateHotelForm() {
  const t = useTranslations('admin.hotels')
  const [state, formAction] = useActionState<HotelFormState, FormData>(createHotel, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Notice state={state} />
      <Fields />
      <SubmitButton label={t('add')} />
    </form>
  )
}

export function EditHotelForm({ hotel }: { hotel: HotelRow }) {
  const tc = useTranslations('common')
  const [state, formAction] = useActionState<HotelFormState, FormData>(updateHotel, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Notice state={state} />
      <input type="hidden" name="id" value={hotel.id} />
      <Fields hotel={hotel} />
      <FormActions label={tc('save')} saved={state?.saved} />
    </form>
  )
}

/**
 * Deactivate is the ordinary action and delete is the exceptional one, so they
 * are ordered and worded that way. The database is what actually decides
 * whether a delete is allowed: `bookings.hotel_id` has no ON DELETE clause, so
 * a hotel that has ever been booked against raises 23503 and the screen says
 * it is in use.
 */
export function HotelStateForms({ hotel }: { hotel: HotelRow }) {
  const t = useTranslations('admin.hotels')
  const [activeState, activeAction] = useActionState<HotelFormState, FormData>(
    setHotelActive, undefined)
  const [deleteState, deleteAction] = useActionState<HotelFormState, FormData>(
    deleteHotel, undefined)

  return (
    <div className="flex flex-col gap-4">
      <Notice state={activeState} />
      <Notice state={deleteState} />

      <form action={activeAction} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={hotel.id} />
        <input type="hidden" name="active" value={hotel.active ? 'false' : 'true'} />
        <p className="text-[0.9375rem] text-ink-soft">{t('deactivateHint')}</p>
        <SubmitButton
          label={hotel.active ? t('deactivate') : t('reactivate')}
          variant="quiet"
        />
      </form>

      <form
        action={deleteAction}
        onSubmit={(e) => {
          if (!confirm(t('deleteConfirm'))) e.preventDefault()
        }}
      >
        <input type="hidden" name="id" value={hotel.id} />
        <SubmitButton label={t('delete')} variant="quiet" />
      </form>
    </div>
  )
}
