'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { confidenceBand } from '@/lib/ocr/merge'
import { captureLicence, type CaptureState } from './actions'

export type StoredLicenceImages = {
  frontUrl: string | null
  backUrl: string | null
  hasFront: boolean
  hasBack: boolean
}

/**
 * R4 step 1 — the camera, front then back, per driver
 * (docs/04-SCREENS.md, R4.1).
 *
 * Two plain file inputs and a submit button, and that is the entire control.
 * `capture="environment"` opens the rear camera on the rep's Android phone;
 * everywhere else — and for anyone using a keyboard, a switch or a screen
 * reader — the same input is the system file picker. Photographing a licence
 * and choosing a photo of one are the same operation to this form, which is
 * what makes the accessible path the ordinary path rather than an alternative
 * bolted on beside it.
 *
 * Nothing here is required. §10 makes manual entry first-class and OCR a
 * convenience on top: the form below this one is complete on its own, this
 * step can be skipped entirely, and every field a read fills stays editable.
 * A read that fails says so and changes nothing else.
 */
export function LicenceCapture({
  bookingId, driverId, isMain, stored,
}: {
  bookingId: string
  driverId?: string
  isMain: boolean
  stored?: StoredLicenceImages
}) {
  const t = useTranslations('pickup')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<CaptureState, FormData>(captureLicence, undefined)

  const suffix = driverId ?? (isMain ? 'main' : 'new')

  return (
    <div className="flex flex-col gap-3 border-b border-line pb-4">
      <div>
        <h4 className="text-[1rem] font-semibold">{t('licenceCaptureTitle')}</h4>
        <p className="text-[0.875rem] text-ink-soft">{t('licenceCaptureIntro')}</p>
      </div>

      {stored && (stored.hasFront || stored.hasBack) ? (
        <div className="flex flex-wrap gap-2">
          <StoredImage url={stored.frontUrl} present={stored.hasFront} label={t('storedFront')} />
          <StoredImage url={stored.backUrl} present={stored.hasBack} label={t('storedBack')} />
        </div>
      ) : null}

      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="booking_id" value={bookingId} />
        <input type="hidden" name="is_main" value={String(isMain)} />
        {driverId ? <input type="hidden" name="driver_id" value={driverId} /> : null}

        {state?.error ? (
          <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
            {te(state.error)}
          </p>
        ) : null}

        {state?.saved ? <ReadOutcome state={state} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="ir-label" htmlFor={`front_${suffix}`}>{t('licenceFront')}</label>
            <input
              id={`front_${suffix}`}
              name="front"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              required
              className="ir-field file:mr-3 file:min-h-9 file:rounded-field file:border-0 file:bg-brand-tint file:px-3 file:font-medium file:text-ink"
            />
          </div>
          <div>
            <label className="ir-label" htmlFor={`back_${suffix}`}>{t('licenceBack')}</label>
            <input
              id={`back_${suffix}`}
              name="back"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="ir-field file:mr-3 file:min-h-9 file:rounded-field file:border-0 file:bg-brand-tint file:px-3 file:font-medium file:text-ink"
              aria-describedby={`back_hint_${suffix}`}
            />
            <p className="ir-hint" id={`back_hint_${suffix}`}>{t('licenceBackHint')}</p>
          </div>
        </div>

        <SubmitButton label={t('readLicence')} variant="quiet" />
        <p className="ir-hint">{t('licenceOptional')}</p>
      </form>
    </div>
  )
}

/**
 * What the read produced, in words.
 *
 * The confidence is shown because docs/01-DECISIONS.md's OCR line and the
 * build plan both ask for it — but it is a prompt to check, never a gate. A
 * low score and a high score both leave the same editable form underneath, and
 * neither one lets or stops anybody doing anything.
 */
function ReadOutcome({ state }: { state: NonNullable<CaptureState> }) {
  const t = useTranslations('pickup')

  if (state.ocrSkipped) {
    return (
      <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
        {t(state.ocrSkipped === 'disabled' ? 'ocrOff'
          : state.ocrSkipped === 'rateLimited' ? 'ocrRateLimited'
          : 'ocrUnreadable')}
      </p>
    )
  }

  const band = confidenceBand(state.confidence ?? null)
  const percent = Math.round((state.confidence ?? 0) * 100)

  return (
    <p
      className={`ir-notice ${band === 'high'
        ? 'border-ok bg-ok-tint text-ok'
        : 'border-warn bg-warn-tint text-warn'}`}
      role="status"
    >
      {t(band === 'high' ? 'ocrHigh' : band === 'medium' ? 'ocrMedium' : 'ocrLow', { percent })}
    </p>
  )
}

/**
 * One stored side of the licence, behind a short-lived signed URL. If the URL
 * could not be issued — or has expired on a page left open at the desk — the
 * label still says the photo is on file, rather than a broken image implying
 * it was never taken.
 */
function StoredImage({ url, present, label }: { url: string | null; present: boolean; label: string }) {
  const t = useTranslations('pickup')
  if (!present) return null

  if (!url) {
    return <p className="text-[0.875rem] text-ink-soft">{t('licenceOnFile', { side: label })}</p>
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" className="rounded-field border border-line p-1">
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed URL with
          a two-minute TTL has no business in the image optimiser's cache. */}
      <img src={url} alt={label} className="h-20 w-32 rounded-[calc(var(--radius-field)-2px)] object-cover" />
    </a>
  )
}
