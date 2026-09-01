import { z } from 'zod'

/**
 * `app_settings.company` — the jsonb column that has existed since Phase 1 and
 * that nothing read or wrote until now.
 *
 * It is the contract's only source for its own header and its own terms
 * (docs/01-DECISIONS.md §28.7: "registered name, address, VAT (ΑΦΜ), phone,
 * insurance provider and policy terms", plus §16's bilingual T&Cs). A10 is
 * nominally Phase 5, but a PDF with nowhere to get its letterhead from is a
 * PDF with an invented letterhead, so the contract half of A10 is built here
 * and the rest — retention window, default windows, users, hotels — stays
 * where the build plan put it.
 *
 * NOTHING IN HERE IS SEEDED WITH A VALUE. Client items 5 (the paper agreement
 * and its terms, both languages) and 7 (company legal details) have not
 * arrived. Inventing a ΑΦΜ or drafting Greek rental terms would put a
 * plausible-looking falsehood on a document a guest signs, so the column stays
 * empty until the boss fills it in, and `contractReadiness()` below is what
 * stops an empty one reaching a signature.
 */
export const companySchema = z.object({
  legal_name: z.string().trim().max(200).default(''),
  address: z.string().trim().max(400).default(''),
  /** ΑΦΜ. Held as typed: format-checking a foreign VAT number is not our job. */
  vat_number: z.string().trim().max(40).default(''),
  phone: z.string().trim().max(40).default(''),
  email: z.string().trim().max(254).default(''),
  insurer: z.string().trim().max(200).default(''),
  insurance_policy: z.string().trim().max(120).default(''),
  /** The agreement's terms, verbatim, in each language. Rendered as typed. */
  terms_el: z.string().trim().max(20_000).default(''),
  terms_en: z.string().trim().max(20_000).default(''),
  /**
   * An optional third, German-language terms block. Unlike terms_el/terms_en
   * it is not part of the required bilingual agreement (§16/§24) — it prints
   * as a supplementary page only when the boss has actually pasted something
   * in, and its absence never blocks contractReadiness() below.
   */
  terms_de: z.string().trim().max(20_000).default(''),
})

export type Company = z.infer<typeof companySchema>

export const EMPTY_COMPANY: Company = companySchema.parse({})

/** Reads the column, tolerating anything that is not the shape we expect. */
export function parseCompany(value: unknown): Company {
  const parsed = companySchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : EMPTY_COMPANY
}

/**
 * The fields without which there is no agreement to sign.
 *
 * `email` and `insurance_policy` are absent deliberately: a contract can print
 * without either, and requiring a field the client may not want published
 * would block the whole flow over a detail.
 */
export const REQUIRED_FOR_CONTRACT = [
  'legal_name', 'address', 'vat_number', 'phone', 'insurer', 'terms_el', 'terms_en',
] as const

export type RequiredCompanyField = (typeof REQUIRED_FOR_CONTRACT)[number]

export type ContractReadiness =
  | { ready: true }
  | { ready: false; missing: RequiredCompanyField[] }

/**
 * Whether a real, signable agreement can be produced yet.
 *
 * This is the guard the phase note asks for: "do not let a placeholder reach
 * anything that looks like a real signed agreement". Until the boss has filled
 * A10 in, the machinery still runs — the layout can be previewed, and the
 * preview is stamped DRAFT in both languages — but the signing step refuses,
 * and says which fields are missing rather than failing vaguely.
 */
export function contractReadiness(company: Company): ContractReadiness {
  const missing = REQUIRED_FOR_CONTRACT.filter((field) => company[field].length === 0)
  return missing.length === 0 ? { ready: true } : { ready: false, missing: [...missing] }
}
