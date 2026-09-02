'use client'

import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FormActions } from '@/components/FormActions'
import type { HandoverState } from '@/lib/handover/fuel'

/**
 * The fuel gauge, in eighths (docs/01-DECISIONS.md §12).
 *
 * A native range input, so the value is reachable with arrow keys, a switch or
 * a screen reader's slider gesture, not only by dragging. The reading is
 * always shown as text as well ("5/8"), and in litres where the model's tank
 * size is known — colour and needle position are never the only signal.
 */
export function FuelSlider({
  bookingId, action, defaultEighths, tankLitres, label, submitLabel, savedLabel, comparedTo,
}: {
  bookingId: string
  action: (prev: HandoverState, formData: FormData) => Promise<HandoverState>
  defaultEighths: number | null
  tankLitres: number | null
  label: string
  submitLabel: string
  savedLabel: string
  comparedTo?: number | null
}) {
  const t = useTranslations('handover')
  const te = useTranslations('errors')
  const [eighths, setEighths] = useState(defaultEighths ?? 8)
  const [state, formAction] = useActionState<HandoverState, FormData>(action, undefined)

  const litres = tankLitres !== null ? (tankLitres * eighths) / 8 : null
  const shortfall = typeof comparedTo === 'number' ? comparedTo - eighths : 0

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="booking_id" value={bookingId} />
      <input type="hidden" name="fuel_eighths" value={eighths} />

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">{te(state.error)}</p>
      ) : null}

      <div>
        <label className="ir-label" htmlFor="fuel_range">{label}</label>
        <input
          id="fuel_range"
          type="range"
          min={0}
          max={8}
          step={1}
          value={eighths}
          onChange={(e) => setEighths(Number(e.target.value))}
          className="h-12 w-full accent-brand"
          aria-describedby="fuel_reading"
          aria-valuetext={t('eighths', { n: eighths })}
        />
        <div className="mt-1 flex justify-between text-[0.8125rem] text-ink-soft" aria-hidden="true">
          <span>{t('empty')}</span>
          <span>½</span>
          <span>{t('full')}</span>
        </div>
      </div>

      <p id="fuel_reading" className="text-[1.0625rem] font-semibold" role="status">
        {t('eighths', { n: eighths })}
        {litres !== null ? <span className="font-normal text-ink-soft"> · {t('litres', { n: litres.toFixed(1) })}</span> : null}
      </p>

      {shortfall > 0 ? (
        <p className="ir-notice border-warn bg-warn-tint text-warn" role="status">
          {t('shortfallNotice', { n: shortfall })}
        </p>
      ) : null}

      <div>
        <label className="ir-label" htmlFor="fuel_notes">{t('notesLabel')}</label>
        <input id="fuel_notes" name="notes" className="ir-field" maxLength={2000} />
      </div>

      <FormActions
        label={submitLabel}
        variant="quiet"
        saved={state?.saved}
        requireChanges={defaultEighths !== null}
        onCancel={() => setEighths(defaultEighths ?? 8)}
      />
      {state?.saved ? <p className="text-[0.875rem] text-ok" role="status">{savedLabel}</p> : null}
    </form>
  )
}
