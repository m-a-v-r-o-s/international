import type { Company } from './company'
import type { DamageView } from '@/app/(app)/bookings/[id]/CarDiagram'
import type { Zone } from '@/lib/damage/zones'

/**
 * Everything the contract prints, assembled before the renderer sees it.
 *
 * The document component is deliberately dumb: it lays out what is in here and
 * makes no decisions, reads no database and formats no money. That keeps the
 * one rule that matters about money — integer cents everywhere, euros only at
 * the render boundary — checkable in one place.
 */
export type ContractDriver = {
  isMain: boolean
  firstName: string
  lastName: string
  dob: string
  licenceNumber: string | null
  licenceCountry: string | null
  licenceIssuedOn: string | null
  licenceExpiresOn: string | null
}

export type ContractMark = {
  view: DamageView
  /** The exact relative coordinates the rep recorded, 0–1 in the diagram box. */
  x: number
  y: number
  /** The zone those coordinates fall in — the mark's description in words. */
  zone: Zone
  markType: 'scratch' | 'dent' | 'chip' | 'crack' | 'other'
  note: string | null
  /** Position in the whole list, so the pin and the line share a number. */
  index: number
}

export type ContractData = {
  company: Company
  /** True when the company details or the terms are not filled in yet. */
  draft: boolean

  ref: string
  startDate: string
  endDate: string
  days: number | null
  pickupAt: string | null
  dropoffAt: string | null
  hotelName: string | null
  roomNumber: string | null

  plate: string
  make: string | null
  model: string | null
  categoryEl: string | null
  categoryEn: string | null
  year: number | null
  colour: string | null

  drivers: ContractDriver[]
  fuelOutEighths: number | null
  marks: ContractMark[]

  totalCents: number | null
  collectedCents: number
  payMethod: 'cash' | 'card' | 'transfer' | null
  paid: boolean

  /** PNG bytes of the on-screen signature, once there is one. */
  signature: Uint8Array | null
  signerName: string | null
  signedAt: string | null
}

/** Money is integer cents everywhere else; this is the render boundary. */
export function euros(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return `€${(cents / 100).toFixed(2)}`
}

/** A stored timestamptz, printed as the desk reads it. */
export function athensTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

export function athensDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(date)
}

/** `date` columns are calendar dates and must never become instants. */
export function calendarDate(value: string | null): string {
  if (!value) return '—'
  const [y, m, d] = value.split('-')
  return y && m && d ? `${d}/${m}/${y}` : value
}
