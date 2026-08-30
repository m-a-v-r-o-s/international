import type { LicenceExtraction } from './schema'

/**
 * What a licence read actually changes on a driver row.
 *
 * Pulled out of the server action and kept pure, because the rule it encodes
 * is the delicate part of docs/01-DECISIONS.md §10 — "pre-filled, ALWAYS
 * editable", and manual entry as a first-class path — and a rule about
 * overwriting someone's typing deserves to be readable and testable on its
 * own, not buried in an upload handler.
 *
 * The rule, in one line: OCR never overwrites a value a human has saved.
 *
 * `booking_drivers.ocr_reviewed` is what "a human has saved this row" means.
 * saveDriver() sets it true when the rep presses Save. So:
 *
 *   · no row yet          → build one from the read, over the booking's own
 *                           guest details for the main driver
 *   · row, not reviewed   → the read replaces what an earlier read put there
 *   · row, reviewed       → the read fills only fields still empty, and never
 *                           touches the name or the date of birth
 *
 * That last case is the one that matters at a desk: a rep who has typed a name
 * off the card because the photo was unreadable, and then takes a better
 * photo, does not watch their work get overwritten by a worse read.
 */
export type DriverLicenceFields = {
  first_name: string
  last_name: string
  dob: string
  licence_number: string | null
  licence_country: string | null
  licence_issued_on: string | null
  licence_expires_on: string | null
}

export type ExistingDriver = Partial<DriverLicenceFields> & { ocr_reviewed: boolean }

export type MergeResult =
  /** Enough to write. `fields` is the whole row's worth of licence detail. */
  | { complete: true; fields: DriverLicenceFields }
  /** Not enough for a NOT NULL name and date of birth — the rep types it in. */
  | { complete: false; missing: ('first_name' | 'last_name' | 'dob')[] }

/** Country codes are stored as the card prints them, upper-cased. */
function country(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toUpperCase()
  return /^[A-Z]{2,3}$/.test(trimmed) ? trimmed : null
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function mergeExtraction(input: {
  existing: ExistingDriver | null
  extraction: LicenceExtraction | null
  /** The guest already captured on the booking (docs/01-DECISIONS.md §9). */
  defaults?: { first_name?: string | null; last_name?: string | null; dob?: string | null }
}): MergeResult {
  const { existing, extraction, defaults } = input
  const reviewed = existing?.ocr_reviewed === true

  // `pick` is the whole rule. `human` is what a person has saved (or, for a
  // new row, what the booking already knows); `read` is what the camera saw.
  const pick = (human: string | null | undefined, read: string | null | undefined) => {
    const kept = text(human)
    if (reviewed) return kept ?? text(read)
    return text(read) ?? kept
  }

  const first_name = pick(existing?.first_name ?? defaults?.first_name, extraction?.first_name)
  const last_name = pick(existing?.last_name ?? defaults?.last_name, extraction?.last_name)
  const dob = pick(existing?.dob ?? defaults?.dob, extraction?.date_of_birth)

  const missing: ('first_name' | 'last_name' | 'dob')[] = []
  if (!first_name) missing.push('first_name')
  if (!last_name) missing.push('last_name')
  if (!dob) missing.push('dob')
  if (!first_name || !last_name || !dob) return { complete: false, missing }

  return {
    complete: true,
    fields: {
      first_name,
      last_name,
      dob,
      licence_number: pick(existing?.licence_number, extraction?.licence_number),
      licence_country: reviewed
        ? country(existing?.licence_country) ?? country(extraction?.issuing_country)
        : country(extraction?.issuing_country) ?? country(existing?.licence_country),
      licence_issued_on: pick(existing?.licence_issued_on, extraction?.issued_on),
      licence_expires_on: pick(existing?.licence_expires_on, extraction?.expires_on),
    },
  }
}

/**
 * How loudly to tell the rep to check the read.
 *
 * Never a gate: a low score changes the wording on the screen and nothing
 * else. The bands are deliberately coarse, because a number like 0.62 read off
 * a phone in sunlight means nothing to anybody.
 */
export function confidenceBand(confidence: number | null): 'high' | 'medium' | 'low' {
  if (confidence === null || confidence < 0.6) return 'low'
  return confidence >= 0.85 ? 'high' : 'medium'
}
