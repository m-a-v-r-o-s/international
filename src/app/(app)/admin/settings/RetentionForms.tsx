'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import { FormActions } from '@/components/FormActions'
import {
  runLicencePurge, saveFuelChargeSettings, saveRetentionSettings, saveWindowSettings,
  type SettingsState,
} from './actions'

function Notice({ state }: { state: SettingsState }) {
  const t = useTranslations('adminSettings')
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

export function RetentionForm({ months }: { months: number }) {
  const t = useTranslations('adminSettings')
  const tc = useTranslations('common')
  const [state, formAction] = useActionState<SettingsState, FormData>(
    saveRetentionSettings, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Notice state={state} />
      <Field
        id="licence_retention_months" name="licence_retention_months" type="number"
        label={t('retentionMonths')} hint={t('retentionMonthsHint')}
        defaultValue={months} min={1} max={120} step={1} required inputMode="numeric"
      />
      <FormActions label={tc('save')} saved={state?.saved} />
    </form>
  )
}

export function FuelChargeForm({ perEighth }: { perEighth: number }) {
  const t = useTranslations('adminSettings')
  const tc = useTranslations('common')
  const [state, formAction] = useActionState<SettingsState, FormData>(
    saveFuelChargeSettings, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Notice state={state} />
      <Field
        id="fuel_charge_per_eighth" name="fuel_charge_per_eighth" type="number"
        label={t('fuelChargeLabel')} hint={t('fuelChargeHint')}
        defaultValue={perEighth} min={0} max={1000} step={1} required inputMode="numeric"
      />
      <FormActions label={tc('save')} saved={state?.saved} />
    </form>
  )
}

export function WindowsForm({
  windows,
}: {
  windows: { pickupFrom: string; pickupTo: string; dropoffFrom: string; dropoffTo: string }
}) {
  const t = useTranslations('adminSettings')
  const tc = useTranslations('common')
  const [state, formAction] = useActionState<SettingsState, FormData>(
    saveWindowSettings, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Notice state={state} />
      <p className="text-[0.9375rem] text-ink-soft">{t('windowsHint')}</p>

      <fieldset className="flex flex-col gap-3">
        <legend className="ir-label">{t('pickupWindow')}</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="pickup_from" name="pickup_from" type="time" label={t('windowFrom')}
            defaultValue={windows.pickupFrom} required
          />
          <Field
            id="pickup_to" name="pickup_to" type="time" label={t('windowTo')}
            defaultValue={windows.pickupTo} required
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="ir-label">{t('dropoffWindow')}</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="dropoff_from" name="dropoff_from" type="time" label={t('windowFrom')}
            defaultValue={windows.dropoffFrom} required
          />
          <Field
            id="dropoff_to" name="dropoff_to" type="time" label={t('windowTo')}
            defaultValue={windows.dropoffTo} required
          />
        </div>
      </fieldset>

      <FormActions label={tc('save')} saved={state?.saved} />
    </form>
  )
}

/**
 * The purge deletes real personal data and cannot be undone, so the button
 * says what it is about to delete before it does it, and the confirm is a
 * checkbox the boss has to tick rather than a dialog he can dismiss by reflex.
 */
export function PurgeForm({ dueCount }: { dueCount: number }) {
  const t = useTranslations('adminSettings')
  const [state, formAction] = useActionState<SettingsState, FormData>(
    runLicencePurge, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Notice state={state} />
      {state?.purged ? (
        <div className="ir-notice border-ok bg-ok-tint text-ok" role="status">
          <p>{t('purgeDone', {
            images: state.purged.deleted,
            bookings: state.purged.bookings,
          })}</p>
          {state.purged.refused > 0 ? (
            <p className="mt-1">{t('purgeRefused', { n: state.purged.refused })}</p>
          ) : null}
        </div>
      ) : null}

      {dueCount === 0 ? (
        <p className="text-[0.9375rem] text-ink-soft">{t('purgeNothingDue')}</p>
      ) : (
        <>
          <label className="flex items-start gap-3 text-[0.9375rem]">
            <input
              type="checkbox" name="confirm" value="yes" required
              className="mt-1 size-5 shrink-0"
            />
            <span>{t('purgeConfirm', { n: dueCount })}</span>
          </label>
          <SubmitButton label={t('purgeNow')} variant="quiet" />
        </>
      )}
    </form>
  )
}
