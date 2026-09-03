'use client'

import { useState } from 'react'
import { Field } from '@/components/Field'
import type { Hotel } from '@/lib/bookings/types'

const OTHER = '__other__'

/**
 * A booking names a registered hotel or types one that is not in the system —
 * never both (docs/01-DECISIONS.md §41). Picking "other" clears the select's
 * `name` so `hotel_id` is simply absent from the submission, and reveals a
 * free-text field bound to `adhoc_hotel_name` instead. The server enforces the
 * same either/or; this is only what makes it obvious at the desk.
 */
export function HotelLocationField({
  hotels, defaultHotelId, defaultAdhocHotelName, label, chooseLabel, otherLabel, otherNameLabel,
  required = true, allowNone = false, noneLabel,
}: {
  hotels: Hotel[]
  defaultHotelId?: string | null
  /** Pre-selects "other" and fills the free-text field, for editing an already ad-hoc booking. */
  defaultAdhocHotelName?: string | null
  label: string
  chooseLabel: string
  otherLabel: string
  otherNameLabel: string
  required?: boolean
  /** Admin-only: a booking may also have no location at all. */
  allowNone?: boolean
  noneLabel?: string
}) {
  const [choice, setChoice] = useState(defaultHotelId || (defaultAdhocHotelName ? OTHER : ''))
  const isOther = choice === OTHER

  return (
    <div>
      <label className="ir-label" htmlFor="hotel_id">{label}</label>
      <select
        id="hotel_id"
        name={isOther ? undefined : 'hotel_id'}
        className="ir-field"
        required={required && !isOther}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
      >
        <option value="" disabled={!allowNone}>{allowNone ? (noneLabel ?? chooseLabel) : chooseLabel}</option>
        {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        <option value={OTHER}>{otherLabel}</option>
      </select>
      {isOther ? (
        <div className="mt-2">
          <Field
            id="adhoc_hotel_name" name="adhoc_hotel_name" label={otherNameLabel}
            defaultValue={defaultAdhocHotelName ?? undefined}
            required={required} maxLength={160}
          />
        </div>
      ) : null}
    </div>
  )
}
