'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { saveDriver, removeDriver, type PickupState } from './actions'
import type { BookingDriverRow } from '@/lib/supabase/database.types'

export type DriverFields = Pick<BookingDriverRow,
  'id' | 'is_main' | 'first_name' | 'last_name' | 'dob'
  | 'licence_number' | 'licence_country' | 'licence_issued_on' | 'licence_expires_on'
  | 'ocr_confidence' | 'ocr_reviewed'>

/**
 * R4 step 1 — one driver, typed in.
 *
 * §10 puts licence OCR on top of this form, never in front of it: "manual
 * entry is a first-class fallback, not an error path", and a worn, non-Latin
 * or non-EU licence must never block a pickup. LicenceCapture pre-fills
 * exactly these fields and they stay editable — one form, filled by hand or by
 * camera, never two.
 *
 * When `ocr_reviewed` is false the values came off a photograph and nobody has
 * looked at them yet, and the form says so. Pressing Save is what marks them
 * reviewed, and what stops a later read overwriting them.
 *
 * The main driver's name and date of birth are pre-filled from what the
 * booking already captured (docs/01-DECISIONS.md §9), because retyping a name
 * with a guest waiting is how wrong names get recorded.
 */
export function DriverForm({
  bookingId, driver, isMain, defaults,
}: {
  bookingId: string
  driver?: DriverFields
  isMain: boolean
  defaults?: { first_name?: string | null; last_name?: string | null; dob?: string | null }
}) {
  const t = useTranslations('pickup')
  const tn = useTranslations('newBooking')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<PickupState, FormData>(saveDriver, undefined)
  const [removeState, removeAction] = useActionState<PickupState, FormData>(removeDriver, undefined)

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="booking_id" value={bookingId} />
        <input type="hidden" name="is_main" value={String(isMain)} />
        {driver ? <input type="hidden" name="id" value={driver.id} /> : null}

        {state?.error ? (
          <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
        ) : null}

        {driver && driver.ocr_reviewed === false ? (
          <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
            {t('ocrUnreviewed')}
            {driver.ocr_confidence !== null ? (
              <span className="mt-1 block font-medium">
                {t('ocrConfidence', { percent: Math.round(Number(driver.ocr_confidence) * 100) })}
              </span>
            ) : null}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field
            id={`first_name_${driver?.id ?? 'new'}`} name="first_name" label={tn('firstName')}
            defaultValue={driver?.first_name ?? defaults?.first_name ?? undefined} required maxLength={80}
            autoComplete="off"
          />
          <Field
            id={`last_name_${driver?.id ?? 'new'}`} name="last_name" label={tn('lastName')}
            defaultValue={driver?.last_name ?? defaults?.last_name ?? undefined} required maxLength={80}
            autoComplete="off"
          />
        </div>

        <Field
          id={`dob_${driver?.id ?? 'new'}`} name="dob" type="date" label={tn('dob')}
          defaultValue={driver?.dob ?? defaults?.dob ?? undefined} required
          hint={t('dobHint')}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field
            id={`licence_number_${driver?.id ?? 'new'}`} name="licence_number" label={t('licenceNumber')}
            defaultValue={driver?.licence_number ?? undefined} required maxLength={40}
            autoComplete="off" autoCapitalize="characters" spellCheck={false}
          />
          <Field
            id={`licence_country_${driver?.id ?? 'new'}`} name="licence_country" label={t('licenceCountry')}
            defaultValue={driver?.licence_country ?? undefined} required maxLength={3}
            hint={t('licenceCountryHint')} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            id={`licence_issued_on_${driver?.id ?? 'new'}`} name="licence_issued_on" type="date"
            label={t('licenceIssued')} defaultValue={driver?.licence_issued_on ?? undefined} required
          />
          <Field
            id={`licence_expires_on_${driver?.id ?? 'new'}`} name="licence_expires_on" type="date"
            label={t('licenceExpires')} defaultValue={driver?.licence_expires_on ?? undefined} required
          />
        </div>

        <SubmitButton label={driver ? tc('save') : t('addDriver')} variant="quiet" />
        {state?.saved ? <p className="text-[0.875rem] text-ok" role="status">{tc('save')} ✓</p> : null}
      </form>

      {driver && !isMain ? (
        <form action={removeAction}>
          <input type="hidden" name="id" value={driver.id} />
          <input type="hidden" name="booking_id" value={bookingId} />
          {removeState?.error ? (
            <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(removeState.error)}</p>
          ) : null}
          <button type="submit" className="min-h-11 text-[0.9375rem] font-medium text-danger underline underline-offset-2">
            {t('removeDriver')}
          </button>
        </form>
      ) : null}
    </div>
  )
}
