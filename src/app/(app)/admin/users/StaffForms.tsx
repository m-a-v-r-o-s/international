'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import type { HotelRow } from '@/lib/supabase/database.types'
import {
  createRep, reissuePassword, setActive, setCover, setHomeHotel, setRole,
  updateStaffDetails, type UserFormState,
} from './actions'

/**
 * A8's forms. Each is its own <form> around its own action rather than one
 * large save button, because the writes are genuinely different operations
 * with different consequences: renaming somebody changes nothing about who
 * sees what, and re-stationing them changes it for every booking at two
 * hotels at once.
 */
function Notice({ state }: { state: UserFormState }) {
  const t = useTranslations('admin.users')
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

/**
 * The password panel. It is `role="alert"` and not dismissible on purpose:
 * this string exists nowhere else — not in a row, not in a log, not in
 * anything the server can be asked for again — so the one thing the screen
 * must not do is let it scroll past unnoticed.
 */
function PasswordPanel({ password, name }: { password: string; name?: string }) {
  const t = useTranslations('admin.users')
  return (
    <div className="ir-notice border-warn bg-warn-tint text-warn" role="alert">
      <p className="font-semibold">{t('passwordTitle', { name: name ?? '' })}</p>
      <p className="mt-1">{t('passwordBody')}</p>
      <p className="ir-label mt-3" id="temp-password-label">{t('passwordLabel')}</p>
      <p
        className="select-all font-mono text-[1.25rem] font-bold tracking-wide text-ink"
        aria-labelledby="temp-password-label"
      >
        {password}
      </p>
    </div>
  )
}

export function CreateRepForm() {
  const t = useTranslations('admin.users')
  const tc = useTranslations('common')
  const [state, formAction] = useActionState<UserFormState, FormData>(createRep, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Notice state={state} />
      {state?.password ? (
        <PasswordPanel password={state.password} name={state.createdName} />
      ) : null}

      <p className="text-[0.9375rem] text-ink-soft">{t('addIntro')}</p>

      <Field id="full_name" name="full_name" label={t('fullName')} maxLength={120} required autoComplete="off" />
      <Field
        id="email" name="email" type="email" label={t('email')} hint={t('emailHint')}
        maxLength={254} required autoComplete="off" inputMode="email"
      />

      <div>
        <label className="ir-label" htmlFor="lang">{t('lang')}</label>
        <select id="lang" name="lang" className="ir-field" defaultValue="el">
          <option value="el">{tc('greek')}</option>
          <option value="en">{tc('english')}</option>
        </select>
      </div>

      <SubmitButton label={t('create')} />
    </form>
  )
}

export function StaffDetailsForm({
  person,
}: {
  person: { id: string; full_name: string; phone: string | null; lang: string }
}) {
  const t = useTranslations('admin.users')
  const tc = useTranslations('common')
  const [state, formAction] = useActionState<UserFormState, FormData>(
    updateStaffDetails, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Notice state={state} />
      <input type="hidden" name="id" value={person.id} />

      <Field
        id="full_name" name="full_name" label={t('fullName')}
        defaultValue={person.full_name} maxLength={120} required autoComplete="off"
      />
      <Field
        id="phone" name="phone" type="tel" label={t('phone')}
        defaultValue={person.phone ?? ''} maxLength={32} autoComplete="off"
      />

      <div>
        <label className="ir-label" htmlFor="lang">{t('lang')}</label>
        <select id="lang" name="lang" className="ir-field" defaultValue={person.lang}>
          <option value="el">{tc('greek')}</option>
          <option value="en">{tc('english')}</option>
        </select>
      </div>

      <SubmitButton label={tc('save')} />
    </form>
  )
}

/**
 * The isolation boundary, on a screen. Changing this select changes which
 * bookings this person can read — at the hotel they leave as well as the one
 * they arrive at — which is why it is one action against one RPC that does
 * both halves in a single transaction.
 */
export function HomeHotelForm({
  person, hotels,
}: {
  person: { id: string; homeHotelId: string | null }
  hotels: HotelRow[]
}) {
  const t = useTranslations('admin.users')
  const tc = useTranslations('common')
  const [state, formAction] = useActionState<UserFormState, FormData>(setHomeHotel, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Notice state={state} />
      <input type="hidden" name="id" value={person.id} />

      <div>
        <label className="ir-label" htmlFor="hotel_id">{t('homeHotel')}</label>
        <select
          id="hotel_id" name="hotel_id" className="ir-field"
          defaultValue={person.homeHotelId ?? ''} aria-describedby="home-hotel-hint"
        >
          <option value="">{t('noHomeHotel')}</option>
          {hotels.map((h) => (
            <option key={h.id} value={h.id}>
              {h.area ? `${h.name} — ${h.area}` : h.name}
            </option>
          ))}
        </select>
        <p className="ir-hint" id="home-hotel-hint">{t('homeHotelHint')}</p>
      </div>

      <SubmitButton label={tc('save')} variant="quiet" />
    </form>
  )
}

export function CoverForm({
  person, hotels, covered,
}: {
  person: { id: string }
  hotels: HotelRow[]
  covered: string[]
}) {
  const t = useTranslations('admin.users')
  const [state, formAction] = useActionState<UserFormState, FormData>(setCover, undefined)
  const addable = hotels.filter((h) => !covered.includes(h.id))

  return (
    <div className="flex flex-col gap-3">
      <Notice state={state} />

      {addable.length > 0 ? (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={person.id} />
          <input type="hidden" name="covers" value="true" />
          <div>
            <label className="ir-label" htmlFor="cover_hotel_id">{t('coverAdd')}</label>
            <select id="cover_hotel_id" name="hotel_id" className="ir-field">
              {addable.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.area ? `${h.name} — ${h.area}` : h.name}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton label={t('coverAdd')} variant="quiet" />
        </form>
      ) : null}
    </div>
  )
}

export function RemoveCoverForm({
  personId, hotel,
}: {
  personId: string
  hotel: HotelRow
}) {
  const t = useTranslations('admin.users')
  const [, formAction] = useActionState<UserFormState, FormData>(setCover, undefined)

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={personId} />
      <input type="hidden" name="hotel_id" value={hotel.id} />
      <input type="hidden" name="covers" value="false" />
      <SubmitButton label={`${t('coverRemove')} — ${hotel.name}`} variant="quiet" />
    </form>
  )
}

export function RoleForm({
  person,
}: {
  person: { id: string; role: 'admin' | 'rep' }
}) {
  const t = useTranslations('admin.users')
  const tr = useTranslations('roles')
  const [state, formAction] = useActionState<UserFormState, FormData>(setRole, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Notice state={state} />
      <input type="hidden" name="id" value={person.id} />

      <div>
        <label className="ir-label" htmlFor="role">{t('roleTitle')}</label>
        <select
          id="role" name="role" className="ir-field" defaultValue={person.role}
          aria-describedby="role-hint"
        >
          <option value="rep">{tr('rep')}</option>
          <option value="admin">{tr('admin')}</option>
        </select>
        <p className="ir-hint" id="role-hint">{t('roleHint')}</p>
      </div>

      <SubmitButton label={t('setRole')} variant="quiet" />
    </form>
  )
}

export function ActiveForm({
  person,
}: {
  person: { id: string; active: boolean }
}) {
  const t = useTranslations('admin.users')
  const [state, formAction] = useActionState<UserFormState, FormData>(setActive, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Notice state={state} />
      <input type="hidden" name="id" value={person.id} />
      <input type="hidden" name="active" value={person.active ? 'false' : 'true'} />
      <p className="text-[0.9375rem] text-ink-soft">{t('accessHint')}</p>
      <SubmitButton
        label={person.active ? t('deactivate') : t('reactivate')}
        variant="quiet"
      />
    </form>
  )
}

export function ReissuePasswordForm({
  person,
}: {
  person: { id: string; full_name: string }
}) {
  const t = useTranslations('admin.users')
  const [state, formAction] = useActionState<UserFormState, FormData>(reissuePassword, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Notice state={state} />
      {state?.password ? (
        <PasswordPanel password={state.password} name={person.full_name} />
      ) : null}
      <input type="hidden" name="id" value={person.id} />
      <p className="text-[0.9375rem] text-ink-soft">{t('reissueHint')}</p>
      <SubmitButton label={t('reissue')} variant="quiet" />
    </form>
  )
}
