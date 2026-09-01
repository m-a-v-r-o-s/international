'use client'

import { useActionState, useEffect, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import type { HotelRow } from '@/lib/supabase/database.types'
import {
  createRep, reissuePin, setActive, setCover, setHomeHotel, setRole,
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
 * The PIN panel, shared by the two actions that mint one: creating the account
 * and re-issuing the credential afterwards. It is `role="alert"` and not
 * dismissible on purpose: this string exists nowhere else — not in a row, not
 * in a log, not in anything the server can be asked for again — so the one
 * thing the screen must not do is let it scroll past unnoticed.
 *
 * The digits are spaced out and large because the boss reads them aloud across
 * a desk, and `select-all` because sometimes he sends them instead.
 */
function PinPanel({ pin, name }: { pin: string; name?: string }) {
  const t = useTranslations('admin.users')
  const labelId = useId()
  return (
    <div className="ir-notice border-warn bg-warn-tint text-warn" role="alert">
      <p className="font-semibold">{t('pinTitle', { name: name ?? '' })}</p>
      <p className="mt-1">{t('pinBody')}</p>
      <p className="ir-label mt-3" id={labelId}>{t('pinLabel')}</p>
      <p
        className="select-all font-mono text-[1.5rem] font-bold tracking-[0.25em] text-ink"
        aria-labelledby={labelId}
      >
        {pin}
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
      {state?.pin ? <PinPanel pin={state.pin} name={state.createdName} /> : null}

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

/** How long the confirm button stays out of reach, as in SignOutButton. */
const CONFIRM_SECONDS = 3

/**
 * Removing somebody's access — the action the boss thinks of as deleting a rep.
 *
 * What it actually calls is setActive({ active: 'false' }), because nothing here
 * ever deletes a staff row: `bookings.created_by` is `not null` with no cascade,
 * so a rep with any history behind them cannot be removed from the table at all,
 * and the history is the point of keeping them (actions.ts, and A8). The BUTTON
 * is therefore named for what the boss wants, and the DIALOG is where the screen
 * is honest about the mechanism — including that it is reversible, which a boss
 * who thinks he has just deleted somebody permanently would otherwise never
 * discover.
 *
 * The ceremony is SignOutButton's, for the same reason and one more. Same
 * reason: a stray tap on a phone should not be able to confirm the dialog it
 * just opened, so the confirm button is dead for three seconds. One more: this
 * is a bigger action than signing out — a rep at a hotel desk stops being able
 * to work the moment it lands — and the bare `confirm()` popup used for
 * cancelling a booking or archiving a car is not enough weight for it.
 */
export function RemoveAccessForm({
  person,
}: {
  person: { id: string; full_name: string }
}) {
  const t = useTranslations('admin.users')
  const tc = useTranslations('common')
  const [state, formAction] = useActionState<UserFormState, FormData>(setActive, undefined)
  const [open, setOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(CONFIRM_SECONDS)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    if (!open) return
    setSecondsLeft(CONFIRM_SECONDS)
    const id = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Close on ANY answer, not just a successful one. The Notice below the
  // trigger is what reports back either way — including IR113, which the
  // database raises if this is ever aimed at the caller's own row, and which
  // would otherwise be announced inside a dialog nobody is looking at any more.
  useEffect(() => {
    if (state) setOpen(false)
  }, [state])

  const ready = secondsLeft === 0

  return (
    <div className="flex flex-col gap-3">
      <Notice state={state} />
      <p className="text-[0.9375rem] text-ink-soft">{t('accessHint')}</p>

      <button type="button" onClick={() => setOpen(true)} className="ir-btn-quiet">
        {t('removeAccess')}
      </button>

      {open && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            className="ir-card w-full max-w-sm bg-surface p-5 shadow-[0_12px_32px_rgba(11,20,32,0.18)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={titleId} className="text-[1.0625rem] font-semibold text-ink">
              {t('removeConfirmTitle', { name: person.full_name })}
            </h2>
            <p id={bodyId} className="mt-2 text-[0.9375rem] text-ink-soft">
              {t('removeConfirmBody')}
            </p>

            <form action={formAction} className="mt-5 flex gap-3">
              <input type="hidden" name="id" value={person.id} />
              <input type="hidden" name="active" value="false" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ir-btn-quiet !w-auto flex-1"
              >
                {tc('cancel')}
              </button>
              <div className="flex-1">
                <SubmitButton
                  label={ready ? t('removeConfirm') : t('removeConfirmWait', { seconds: secondsLeft })}
                  variant="quiet"
                  disabled={!ready}
                />
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The other direction, and deliberately plain. Giving somebody their access
 * back takes nothing away and undoes nothing, so it gets no dialog, no delay
 * and no warning — the ceremony above exists because of what deactivating
 * costs, not because the toggle is important.
 */
export function RestoreAccessForm({
  person,
}: {
  person: { id: string }
}) {
  const t = useTranslations('admin.users')
  const [state, formAction] = useActionState<UserFormState, FormData>(setActive, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Notice state={state} />
      <input type="hidden" name="id" value={person.id} />
      <input type="hidden" name="active" value="true" />
      <p className="text-[0.9375rem] text-ink-soft">{t('restoreHint')}</p>
      <SubmitButton label={t('reactivate')} variant="quiet" />
    </form>
  )
}

export function ReissuePinForm({
  person,
}: {
  person: { id: string; full_name: string }
}) {
  const t = useTranslations('admin.users')
  const [state, formAction] = useActionState<UserFormState, FormData>(reissuePin, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Notice state={state} />
      {state?.pin ? <PinPanel pin={state.pin} name={person.full_name} /> : null}
      <input type="hidden" name="id" value={person.id} />
      <p className="text-[0.9375rem] text-ink-soft">{t('reissueHint')}</p>
      <SubmitButton label={t('reissue')} variant="quiet" />
    </form>
  )
}
