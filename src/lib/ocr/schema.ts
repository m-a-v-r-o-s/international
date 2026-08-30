import { z } from 'zod'

/**
 * What we will accept back from a licence read, and nothing else.
 *
 * Kept apart from the call itself (src/lib/ocr/licence.ts, which is
 * `server-only`) because this schema is the security boundary and deserves to
 * be readable and testable on its own: docs/03-SECURITY.md's AI boundary rule
 * is "the response is parsed into a strict schema and anything outside it is
 * discarded", and a schema you cannot exercise without an API key is a schema
 * nobody exercises.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * Every field is nullable, and that is the design. A worn card gives up three
 * fields out of seven; a Chinese licence gives up none of the dates in a form
 * we can use. Both are a partial pre-fill on an editable form, not a failure.
 */
export const licenceExtractionSchema = z.object({
  first_name: z.string().trim().min(1).max(80).nullable(),
  last_name: z.string().trim().min(1).max(80).nullable(),
  date_of_birth: isoDate.nullable(),
  licence_number: z.string().trim().min(1).max(40).nullable(),
  /** The code printed on the card: ISO alpha-2 where it is one, else as shown. */
  issuing_country: z.string().trim().regex(/^[A-Za-z]{2,3}$/).nullable(),
  issued_on: isoDate.nullable(),
  expires_on: isoDate.nullable(),
  /** How sure the model is that it read the card correctly, 0–1. Shown to the rep. */
  confidence: z.number().min(0).max(1),
})

export type LicenceExtraction = z.infer<typeof licenceExtractionSchema>

