'use client'

import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { extendBooking, type FormState } from '../actions'
import { checkExtension, type ExtensionCheckState } from './extend-actions'

/**
 * R7 · Extend. Two steps in one form: check whether the current car is free
 * through the new date, and if not, let the rep pick a same-category
 * alternative before confirming (docs/01-DECISIONS.md §18). The actual write
 * still goes through the guard trigger, which is the real authority on
 * whether the swap is allowed — this UI only avoids sending a doomed request.
 */
export function ExtendBookingForm({
  bookingId, carId, currentEnd,
}: {
  bookingId: string
  carId: string
  currentEnd: string
}) {
  const t = useTranslations('bookingDetail')
  const tc = useTranslations('common')
  const te = useTranslations('errors')

  const [newEnd, setNewEnd] = useState(currentEnd)
  const [checked, setChecked] = useState<{ end: string } | null>(null)
  const [chosenCar, setChosenCar] = useState(carId)

  const [checkState, checkAction, checkPending] = useActionState<ExtensionCheckState, FormData>(
    checkExtension, undefined)
  const [confirmState, confirmAction] = useActionState<FormState, FormData>(extendBooking, undefined)

  const canConfirm = checked?.end === newEnd
    && (checkState?.currentCarFree || (chosenCar !== carId && chosenCar))

  return (
    <div className="flex flex-col gap-4">
      <form
        action={(fd) => { checkAction(fd); setChecked({ end: newEnd }) }}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="booking_id" value={bookingId} />
        <input type="hidden" name="car_id" value={carId} />
        <input type="hidden" name="start_date" value={currentEnd} />

        <div>
          <label className="ir-label" htmlFor="new_end_date">{t('newReturnDate')}</label>
          <input
            id="new_end_date" name="new_end_date" type="date" className="ir-field" required
            min={currentEnd} value={newEnd}
            onChange={(e) => { setNewEnd(e.target.value); setChecked(null) }}
          />
        </div>

        <SubmitButton label={t('checkAvailability')} variant="quiet" />
      </form>

      {checkPending ? <p className="text-ink-soft">{tc('loading')}</p> : null}

      {checkState?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(checkState.error)}</p>
      ) : null}

      {checked?.end === newEnd && checkState && !checkState.error ? (
        checkState.currentCarFree ? (
          <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">{t('extendCarFree')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">{t('extendCarTaken')}</p>
            {(checkState.alternatives ?? []).length === 0 ? (
              <p className="text-ink-soft">{t('noAlternatives')}</p>
            ) : (
              <div>
                <label className="ir-label" htmlFor="alt_car">{t('chooseAlternative')}</label>
                <select
                  id="alt_car" className="ir-field" value={chosenCar}
                  onChange={(e) => setChosenCar(e.target.value)}
                >
                  <option value={carId}>{t('keepSameCar')}</option>
                  {checkState.alternatives!.map((c) => (
                    <option key={c.id} value={c.id}>{c.plate} — {c.make} {c.model}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )
      ) : null}

      {canConfirm ? (
        <form action={confirmAction} className="flex flex-col gap-3 border-t border-line pt-3">
          <input type="hidden" name="id" value={bookingId} />
          <input type="hidden" name="end_date" value={newEnd} />
          {chosenCar !== carId ? <input type="hidden" name="car_id" value={chosenCar} /> : null}
          {confirmState?.error ? (
            <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(confirmState.error)}</p>
          ) : null}
          <SubmitButton label={t('confirmExtend')} />
        </form>
      ) : null}
    </div>
  )
}
