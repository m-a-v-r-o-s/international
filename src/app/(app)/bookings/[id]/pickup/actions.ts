'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { saveHandoverFuel, type HandoverState } from '@/lib/handover/fuel'
import { readLicence, type LicenceExtraction } from '@/lib/ocr/licence'
import { mergeExtraction, type ExistingDriver } from '@/lib/ocr/merge'
import { sniffType, IMAGE_TYPES, type SniffedType } from '@/lib/storage/sniff'
import { uploadBookingFile, MAX_UPLOAD_BYTES } from '@/lib/storage/booking-files'
import { euroAmountSchema } from '@/lib/money'

export type PickupState = { error?: ErrorKey; saved?: boolean } | undefined

/**
 * The camera step reports more than "saved": the rep has to be told whether
 * the read worked, and how sure it was, because every field it filled is
 * theirs to correct (docs/01-DECISIONS.md §10).
 */
export type CaptureState = {
  error?: ErrorKey
  saved?: boolean
  /** Set when the photos were stored but nothing could be read off them. */
  ocrSkipped?: 'disabled' | 'rateLimited' | 'unreadable' | 'failed'
  confidence?: number | null
} | undefined

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const nameSchema = z.string().trim().min(1).max(80)

/**
 * R4 step 1 — driver entry, manual.
 *
 * `docs/01-DECISIONS.md` §10 makes manual entry a first-class path rather than
 * an error path, and OCR a convenience on top of it. This is that first-class
 * path, unchanged by Phase 4: a rep who never takes a photo fills this form in
 * and the pickup proceeds. captureLicence() below writes to the same row and
 * the same fields, which is why there is one form here and not two.
 *
 * Every driver on the booking is checked at the gate, not only the main one —
 * an additional driver is free of charge (§9) but is still driving
 * (app.assert_drivers_eligible()).
 */
export async function saveDriver(_prev: PickupState, formData: FormData): Promise<PickupState> {
  await requireUnlocked()

  const parsed = z.object({
    id: uuidSchema.optional(),
    booking_id: uuidSchema,
    is_main: z.coerce.boolean(),
    first_name: nameSchema,
    last_name: nameSchema,
    dob: dateSchema,
    licence_number: z.string().trim().min(1).max(40),
    licence_country: z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}$/),
    licence_issued_on: dateSchema,
    licence_expires_on: dateSchema,
  }).safeParse({
    id: formData.get('id') || undefined,
    booking_id: formData.get('booking_id'),
    is_main: formData.get('is_main') === 'true',
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    dob: formData.get('dob'),
    licence_number: formData.get('licence_number'),
    licence_country: formData.get('licence_country'),
    licence_issued_on: formData.get('licence_issued_on'),
    licence_expires_on: formData.get('licence_expires_on'),
  })
  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.licence_expires_on < parsed.data.licence_issued_on) return { error: 'IR104' }

  const { id, booking_id, ...fields } = parsed.data
  const supabase = await supabaseServer()

  // A human has now looked at these values and pressed Save, which is exactly
  // what `ocr_reviewed` records — and what stops a later licence read from
  // overwriting them (src/lib/ocr/merge.ts).
  const reviewed = { ...fields, ocr_reviewed: true }

  // `booking_drivers_rw` resolves to app.can_read_booking(), so a booking id
  // belonging to another rep is refused by the policy, not by this check.
  const { error } = id
    ? await supabase.from('booking_drivers').update(reviewed).eq('id', id).eq('booking_id', booking_id)
    : await supabase.from('booking_drivers').insert({ booking_id, ...reviewed })

  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${booking_id}/pickup`)
  return { saved: true }
}

export async function removeDriver(_prev: PickupState, formData: FormData): Promise<PickupState> {
  await requireUnlocked()

  const parsed = z.object({ id: uuidSchema, booking_id: uuidSchema }).safeParse({
    id: formData.get('id'),
    booking_id: formData.get('booking_id'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('booking_drivers')
    .delete().eq('id', parsed.data.id).eq('booking_id', parsed.data.booking_id)

  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${parsed.data.booking_id}/pickup`)
  return { saved: true }
}

/**
 * R4 step 1 — the camera.
 *
 * Front, and optionally back, of one driver's licence: stored in the private
 * bucket, read by Claude vision server-side, and used to PRE-FILL the form
 * that already existed. The order is deliberate and is the whole of §10:
 *
 *   · the photos are stored whether or not the read works, because §9 requires
 *     "photo of front and back" as a record in its own right;
 *   · the read runs on the bytes in memory, before the upload, so a licence
 *     that turns out to be a photo of a hotel breakfast has cost one call and
 *     not a stored file;
 *   · nothing about a failed read is an error state. Worn, non-Latin and
 *     non-EU licences must not block a pickup, so `ocrSkipped` is a note on a
 *     form the rep was always going to be able to fill in by hand.
 *
 * What it will NOT do is overwrite what a rep has already typed and saved —
 * see mergeExtraction(), where that rule lives and is tested.
 */
export async function captureLicence(_prev: CaptureState, formData: FormData): Promise<CaptureState> {
  const staff = await requireUnlocked()

  const parsed = z.object({
    booking_id: uuidSchema,
    driver_id: uuidSchema.optional(),
    is_main: z.coerce.boolean(),
  }).safeParse({
    booking_id: formData.get('booking_id'),
    driver_id: formData.get('driver_id') || undefined,
    is_main: formData.get('is_main') === 'true',
  })
  if (!parsed.success) return { error: 'IR104' }
  const { booking_id, driver_id, is_main } = parsed.data

  const front = await readImage(formData.get('front'))
  const back = await readImage(formData.get('back'))
  if (front.error) return { error: front.error }
  if (back.error) return { error: back.error }
  if (!front.image) return { error: 'IR104' }

  const supabase = await supabaseServer()

  // Everything below is scoped to rows this session can already read. A
  // booking id belonging to another rep comes back empty from the policy, and
  // the bucket refuses the upload independently.
  const { data: booking } = await supabase.from('bookings')
    .select('id, cust_first, cust_last, cust_dob').eq('id', booking_id).eq('kind', 'rental')
    .maybeSingle()
  if (!booking) return { error: 'forbidden' }

  const { data: existingRow } = driver_id
    ? await supabase.from('booking_drivers')
        .select('id, first_name, last_name, dob, licence_number, licence_country, licence_issued_on, licence_expires_on, ocr_reviewed')
        .eq('id', driver_id).eq('booking_id', booking_id).maybeSingle()
    : { data: null }
  if (driver_id && !existingRow) return { error: 'IR112' }
  const existing = existingRow as
    (ExistingDriver & { id: string }) | null

  const read = await readLicence(
    { front: front.image, back: back.image ?? undefined }, staff.id)
  const extraction: LicenceExtraction | null = read.ok ? read.extraction : null

  const merged = mergeExtraction({
    existing,
    extraction,
    defaults: is_main
      ? { first_name: booking.cust_first, last_name: booking.cust_last, dob: booking.cust_dob }
      : undefined,
  })

  // No name and no date of birth means there is no row to write — those two
  // are NOT NULL, and inventing a placeholder to hold a photo would put a
  // fictitious driver on a rental agreement. The rep types the driver in
  // first, exactly as they could before this step existed.
  if (!merged.complete) {
    return { error: 'ocrFailed', ocrSkipped: read.ok ? 'unreadable' : read.reason }
  }

  const driverId = existing?.id ?? crypto.randomUUID()

  const { error: writeError } = existing
    ? await supabase.from('booking_drivers').update({
        ...merged.fields,
        ocr_confidence: extraction?.confidence ?? null,
      }).eq('id', driverId).eq('booking_id', booking_id)
    : await supabase.from('booking_drivers').insert({
        id: driverId,
        booking_id,
        is_main,
        ...merged.fields,
        ocr_confidence: extraction?.confidence ?? null,
        // A machine filled this in. It stays false until a human presses Save.
        ocr_reviewed: false,
      })
  if (writeError) return { error: errorKey(writeError) }

  // The photos go under the driver they belong to, so the retention purge and
  // a re-take both address exactly one file.
  const paths: { front_image_path?: string; back_image_path?: string } = {}
  for (const [side, image] of [['front', front.image], ['back', back.image]] as const) {
    if (!image) continue
    const uploaded = await uploadBookingFile(supabase, {
      bookingId: booking_id, kind: 'licences', basename: `${driverId}-${side}`, bytes: image.bytes,
    })
    if (!uploaded.ok) return { error: uploaded.reason }
    paths[side === 'front' ? 'front_image_path' : 'back_image_path'] = uploaded.path
  }

  if (Object.keys(paths).length > 0) {
    await supabase.from('booking_drivers').update(paths)
      .eq('id', driverId).eq('booking_id', booking_id)
  }

  revalidatePath(`/bookings/${booking_id}/pickup`)
  return {
    saved: true,
    confidence: extraction?.confidence ?? null,
    ...(read.ok ? {} : { ocrSkipped: read.reason }),
  }
}

/** One uploaded side, validated by its CONTENT before anything else happens. */
async function readImage(
  entry: FormDataEntryValue | null,
): Promise<{ image?: { bytes: Uint8Array; type: SniffedType }; error?: ErrorKey }> {
  if (!(entry instanceof File) || entry.size === 0) return {}
  if (entry.size > MAX_UPLOAD_BYTES) return { error: 'fileTooLarge' }

  const bytes = new Uint8Array(await entry.arrayBuffer())
  const type = sniffType(bytes)
  if (!type || !IMAGE_TYPES.includes(type)) return { error: 'fileType' }

  return { image: { bytes, type } }
}

/**
 * R4 step 3 — fuel out. The write itself is shared with R5's fuel in
 * (src/lib/handover/fuel.ts); which `handovers.kind` it lands on is decided
 * by which flow you are in, not by anything the client sends.
 */
export async function saveFuelOut(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  return saveHandoverFuel(formData, 'pickup')
}

/**
 * R4 step 7 — payment. Amount collected, method, paid/unpaid
 * (docs/01-DECISIONS.md §15). No deposit is taken and none is built.
 *
 * A rep never sets the PRICE — `total` is not in their column grant and
 * the guard trigger would revert it anyway. What they record here is what the
 * guest actually handed over, which is a different number and the only money
 * field a rep may write.
 */
export async function savePayment(_prev: PickupState, formData: FormData): Promise<PickupState> {
  await requireUnlocked()

  const parsed = z.object({
    booking_id: uuidSchema,
    collected: euroAmountSchema,
    pay_method: z.enum(['cash', 'card', 'transfer']).nullable(),
    paid: z.coerce.boolean(),
  }).safeParse({
    booking_id: formData.get('booking_id'),
    collected: formData.get('collected') || 0,
    pay_method: formData.get('pay_method') || null,
    paid: formData.get('paid') === 'on',
  })
  if (!parsed.success) return { error: 'IR104' }

  const { booking_id, ...fields } = parsed.data
  const supabase = await supabaseServer()
  const { error } = await supabase.from('bookings').update(fields).eq('id', booking_id)

  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${booking_id}/pickup`)
  return { saved: true }
}

/**
 * R4 confirm → Out.
 *
 * The eligibility gate lives on this transition, in the database
 * (app.assert_drivers_eligible(), supabase/migrations/20260830091000_guards.sql).
 * There is deliberately no check here that could be forgotten, skipped or
 * routed around: this action sends the transition and reports what the
 * database said. IR120 means a driver failed a rule, IR121 means no driver was
 * recorded at all, and neither has a rep-side override — only the boss's
 * admin_override_eligibility() clears it (docs/01-DECISIONS.md §11).
 */
export async function completePickup(_prev: PickupState, formData: FormData): Promise<PickupState> {
  await requireUnlocked()

  const parsed = uuidSchema.safeParse(formData.get('booking_id'))
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('bookings').update({ status: 'out' }).eq('id', parsed.data)

  if (error) return { error: errorKey(error) }

  revalidatePath(`/bookings/${parsed.data}`)
  revalidatePath(`/bookings/${parsed.data}/pickup`)
  revalidatePath('/')
  return { saved: true }
}
