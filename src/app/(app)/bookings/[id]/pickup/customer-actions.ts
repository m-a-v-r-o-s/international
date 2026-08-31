'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import type { ErrorKey } from '@/lib/errors'
import { reuseLicenceImages } from '@/lib/customers/licence-reuse'

export type ReuseState = { error?: ErrorKey | 'noImages'; saved?: number } | undefined

const uuidSchema = z.string().uuid()

/**
 * "Use the photos we already have" — the second half of the returning-guest
 * flow (docs/01-DECISIONS.md §25a).
 *
 * It is a BUTTON and not something the page does on its own, deliberately. The
 * form fields fill themselves the moment a known number is recognised, which
 * is what the owner asked for and costs nothing if it is wrong — the rep can
 * see every value and type over it. Copying a photograph of a driving licence
 * from one rental to another is a different weight of act: it moves special-
 * category-adjacent data between bookings, it is the one place the service
 * role reads across the §8 boundary, and if the number was entered wrongly it
 * would put a stranger's licence in the agreement. So it waits to be asked.
 *
 * The driver row must exist first, because the images are stored under the
 * driver they belong to. In practice it does: the fields were pre-filled from
 * the ledger and the rep pressed Save before reaching for this.
 */
export async function reuseCustomerLicence(
  _prev: ReuseState, formData: FormData,
): Promise<ReuseState> {
  const staff = await requireUnlocked()

  const parsed = z.object({
    booking_id: uuidSchema,
    customer_id: uuidSchema,
    driver_id: uuidSchema,
  }).safeParse({
    booking_id: formData.get('booking_id'),
    customer_id: formData.get('customer_id'),
    driver_id: formData.get('driver_id'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const outcome = await reuseLicenceImages(supabase, {
    customerId: parsed.data.customer_id,
    bookingId: parsed.data.booking_id,
    driverId: parsed.data.driver_id,
    actorId: staff.id,
  })

  if (!outcome.ok) return { error: outcome.reason }

  revalidatePath(`/bookings/${parsed.data.booking_id}/pickup`)
  return { saved: outcome.sides.length }
}
