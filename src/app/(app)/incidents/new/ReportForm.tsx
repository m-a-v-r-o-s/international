'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { submitIncident, type ReportState } from '../actions'

/**
 * Pick the contract, say what happened, add photographs, send.
 *
 * One form and one action, dispatching on which button was pressed, for two
 * reasons. The photo paths already uploaded have to survive every submission,
 * and holding them in one place is the difference between a draft and a race;
 * and each button is then a plain submit, so a rep whose JavaScript has not
 * loaded on hotel wifi still has a working form rather than a dead page.
 *
 * The photo goes up on its OWN submission, one at a time. A phone photo is
 * megabytes: a form that carried four of them plus the text in one post is a
 * form that times out at a desk with two bars of signal, and would lose the
 * words along with the pictures.
 */
export function ReportForm({
  bookings, defaultBookingId,
}: {
  bookings: { id: string; label: string }[]
  defaultBookingId?: string
}) {
  const t = useTranslations('incidents')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<ReportState, FormData>(submitIncident, undefined)
  const fileRef = useRef<HTMLInputElement>(null)

  const photos = state?.photos ?? []

  // React resets the form once the action returns, so the two fields the rep
  // has already filled in are re-seeded from what came back. `key` is what
  // makes that stick: an uncontrolled field ignores a changed defaultValue
  // unless it is remounted.
  const draftKey = `${photos.length}:${state?.error ?? ''}:${state?.photoError ?? ''}`

  // A file input keeps showing the last file it sent, which after an upload is
  // a picture already in the bucket — so the next tap looks like it will
  // re-send the same one. Cleared once the count changes.
  useEffect(() => {
    if (fileRef.current) fileRef.current.value = ''
  }, [photos.length])

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {photos.map((path) => <input key={path} type="hidden" name="photos" value={path} />)}

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
          {te(state.error)}
        </p>
      ) : null}

      <div>
        <label className="ir-label" htmlFor="booking_id">{t('whichContract')}</label>
        <select
          key={draftKey}
          id="booking_id" name="booking_id" className="ir-field"
          defaultValue={state?.bookingId || defaultBookingId || ''} required
        >
          <option value="" disabled>{t('choose')}</option>
          {bookings.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <p className="ir-hint">{t('whichContractHint')}</p>
      </div>

      <div>
        <label className="ir-label" htmlFor="note">{t('whatHappened')}</label>
        <textarea
          key={draftKey}
          id="note" name="note" className="ir-field min-h-32" rows={5} maxLength={2000}
          defaultValue={state?.note ?? ''}
          placeholder={t('notePlaceholder')}
        />
        <p className="ir-hint">{t('whatHappenedHint')}</p>
      </div>

      <div className="ir-card flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-[1rem] font-semibold">{t('photos')}</h2>
          <p className="ir-hint">{t('photosHint')}</p>
        </div>

        {state?.photoError ? (
          <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
            {te(state.photoError)}
          </p>
        ) : null}

        {photos.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {photos.map((path, index) => (
              <li key={path} className="flex items-center justify-between gap-3">
                <span className="text-[0.9375rem]">{t('photoAdded', { n: index + 1 })}</span>
                {/* The button carries which photo it means in its own value,
                    so removing one needs no script at all. */}
                <button
                  type="submit" name="intent" value={`remove-photo:${path}`}
                  className="text-[0.875rem] text-danger underline underline-offset-2"
                  formNoValidate
                >
                  {t('removePhoto')}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div>
          <label className="ir-label" htmlFor="photo">{t('addPhoto')}</label>
          <input
            ref={fileRef}
            id="photo" name="photo" type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="ir-field"
          />
        </div>

        <button type="submit" name="intent" value="add-photo" className="ir-btn-quiet">
          {t('uploadPhoto')}
        </button>
      </div>

      <SubmitButton label={t('sendAction')} />
    </form>
  )
}
