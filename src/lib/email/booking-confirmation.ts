import 'server-only'

import { athensDateTime } from '@/lib/contract/data'
import { formatEuros } from '@/lib/money'
import { mailConfigured, send, type MailResult } from './mailer'

export type ConfirmationCategory = {
  nameEl: string
  nameEn: string
  minDriverAge: number
  minLicenceYears: number
}

export type BookingConfirmationInput = {
  to: string
  ref: string
  carLabel: string
  hotelName: string | null
  roomNumber: string | null
  pickupAt: string | null
  dropoffAt: string | null
  total: number | null
  category: ConfirmationCategory | null
}

/**
 * The email a rep's successful booking sends the guest: pickup time, return
 * time, cost and the licence they need to bring — the four things a guest
 * actually wants confirmed in writing before they arrive
 * (docs/01-DECISIONS.md, "Exception bookings wait for the boss").
 *
 * Bilingual on the same message, the same choice §16 already made for the
 * signed agreement, and for the same reason: the client serves both Greek and
 * foreign guests and a single-language confirmation would be unreadable to
 * half of them.
 *
 * `category` is null only when the booking's category could not be resolved
 * (an archived or deleted category on an old row) — the licence line is
 * dropped rather than guessed, never invented as "contact us".
 *
 * Never a reason to fail the booking that already exists: the row is written
 * first, this runs after, and its result is reported to the rep as
 * `mailPending` rather than surfaced as a booking error — the same posture
 * emailContract() already takes at the signing step.
 */
export async function sendBookingConfirmation(input: BookingConfirmationInput): Promise<MailResult> {
  if (!mailConfigured()) return { sent: false, reason: 'not_configured' }

  const money = formatEuros(input.total)
  const licenceLine = input.category
    ? [
        `Ελάχιστη ηλικία οδηγού: ${input.category.minDriverAge}. ` +
          `Δίπλωμα οδήγησης τουλάχιστον ${input.category.minLicenceYears} ${input.category.minLicenceYears === 1 ? 'έτος' : 'έτη'}.`,
        `Minimum driver age: ${input.category.minDriverAge}. ` +
          `Driving licence held at least ${input.category.minLicenceYears} ${input.category.minLicenceYears === 1 ? 'year' : 'years'}.`,
      ]
    : [null, null]

  const text = [
    `Κράτηση ${input.ref}`,
    '',
    `Αυτοκίνητο: ${input.carLabel}`,
    input.hotelName ? `Ξενοδοχείο: ${input.hotelName}${input.roomNumber ? `, δωμάτιο ${input.roomNumber}` : ''}` : null,
    `Παραλαβή: ${athensDateTime(input.pickupAt)}`,
    `Επιστροφή: ${athensDateTime(input.dropoffAt)}`,
    `Κόστος: ${money}`,
    licenceLine[0],
    '',
    '-----',
    '',
    `Booking ${input.ref}`,
    '',
    `Car: ${input.carLabel}`,
    input.hotelName ? `Hotel: ${input.hotelName}${input.roomNumber ? `, room ${input.roomNumber}` : ''}` : null,
    `Pick-up: ${athensDateTime(input.pickupAt)}`,
    `Return: ${athensDateTime(input.dropoffAt)}`,
    `Cost: ${money}`,
    licenceLine[1],
  ].filter((line): line is string => line !== null).join('\n')

  return send({
    to: input.to,
    subject: `Επιβεβαίωση κράτησης / Booking confirmation: ${input.ref}`,
    text,
  })
}
