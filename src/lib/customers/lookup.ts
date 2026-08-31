import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../supabase/database.types'
import { errorKey, type ErrorKey } from '../errors'

/**
 * Looking a returning guest up by phone number (docs/01-DECISIONS.md §25a).
 *
 * There is very little code here, and that is the point. The decision this
 * feature turns on — that ANY rep may match ANY past customer, company-wide,
 * which is a real widening of §8's cross-rep rule — is enforced in
 * public.customer_by_phone(), a security-definer function that owns the exact-
 * match rule, the rate limit and the audit line. Reps hold no SELECT on
 * public.customers at all, so there is no second path to this data for this
 * module to have to be careful about, and nothing here that could be relaxed
 * later without the database noticing.
 *
 * WHAT THE FUNCTION WILL NOT GIVE BACK, and why the shape below has holes in
 * it: the guest's phone number (the caller already typed it; echoing it turns
 * a miss into a confirmation oracle), any booking, hotel, room, price or rep
 * (all of it §8's), and the paths to their licence photographs — those are a
 * strictly larger disclosure and are asked for separately, only when the rep
 * has actually chosen to reuse them (src/lib/customers/licence-reuse.ts).
 */
export type CustomerMatch = {
  customerId: string
  firstName: string | null
  lastName: string | null
  dob: string | null
  licenceNumber: string | null
  licenceCountry: string | null
  licenceIssuedOn: string | null
  licenceExpiresOn: string | null
  /** Their last licence photos are still in the bucket and can be copied forward. */
  hasLicenceImages: boolean
  lastSeenAt: string
}

export type LookupOutcome =
  | { ok: true; match: CustomerMatch | null }
  | { ok: false; reason: ErrorKey }

type Client = SupabaseClient<Database>

export async function findCustomerByPhone(
  supabase: Client, phone: string,
): Promise<LookupOutcome> {
  // The normaliser lives in Postgres (app.phone_e164), so what is sent is
  // whatever the rep typed and the database decides what it means. There is
  // deliberately no client-side normalisation to disagree with it.
  const { data, error } = await supabase.rpc('customer_by_phone', { p_phone: phone })

  // IR122 is the lookup rate limit. It is not a failure of the pickup — the
  // rep types the details in as they always could — so it comes back as its
  // own key rather than as a generic error.
  if (error) return { ok: false, reason: errorKey(error) }

  const row = data?.[0]
  if (!row) return { ok: true, match: null }

  return {
    ok: true,
    match: {
      customerId: row.customer_id,
      firstName: row.first_name ?? null,
      lastName: row.last_name ?? null,
      dob: row.dob ?? null,
      licenceNumber: row.licence_number ?? null,
      licenceCountry: row.licence_country ?? null,
      licenceIssuedOn: row.licence_issued_on ?? null,
      licenceExpiresOn: row.licence_expires_on ?? null,
      hasLicenceImages: row.has_licence_images === true,
      lastSeenAt: row.last_seen_at,
    },
  }
}
