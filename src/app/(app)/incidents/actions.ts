'use server'

import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import {
  uploadBookingFile, MAX_UPLOAD_BYTES, BOOKING_FILES_BUCKET,
} from '@/lib/storage/booking-files'
import { parseBookingFilePath } from '@/lib/storage/paths'

const uuidSchema = z.string().uuid()

/**
 * A photo that failed to upload is reported on its own, not as a failure of
 * the whole report: a rep at a hotel desk with one picture that will not go up
 * should still be able to send the words, and add the picture again after.
 */
export type ReportState = {
  error?: ErrorKey
  photoError?: ErrorKey
  /** Paths already in the bucket, carried across submissions of the same draft. */
  photos?: string[]
  /**
   * The half-written report itself. React resets a form once its action
   * returns, so a rep who types three sentences and then adds a photograph
   * would watch the sentences disappear. These two come back out of the state
   * and go back in as the fields' defaults.
   */
  note?: string
  bookingId?: string
  saved?: boolean
} | undefined

/**
 * Put one photo in the bucket, before any incident row exists.
 *
 * The path keys on the BOOKING (`<booking_id>/incidents/<uuid>.jpg`), which is
 * what the storage policies read, so a photo can be uploaded and authorised
 * before there is anything to attach it to. That is what lets the rep build
 * the report up one picture at a time — a phone photo is megabytes and a form
 * carrying four of them at once is a form that fails on hotel wifi — and still
 * send the whole thing in one movement at the end.
 *
 * A fresh random basename every time: `incidents` is deliberately not a
 * replaceable kind, so nothing here can overwrite a picture already taken.
 */
async function addIncidentPhoto(formData: FormData): Promise<ReportState> {
  await requireUnlocked()

  const draft = { ...draftOf(formData), photos: photoPaths(formData) }
  const parsed = uuidSchema.safeParse(formData.get('booking_id'))
  if (!parsed.success) return { ...draft, error: 'IR104' }

  const file = formData.get('photo')
  if (!(file instanceof File) || file.size === 0) {
    return { ...draft, photoError: 'fileType' }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ...draft, photoError: 'fileTooLarge' }
  }

  const supabase = await supabaseServer()
  const uploaded = await uploadBookingFile(supabase, {
    bookingId: parsed.data,
    kind: 'incidents',
    basename: randomUUID(),
    bytes: new Uint8Array(await file.arrayBuffer()),
  })
  if (!uploaded.ok) return { ...draft, photoError: uploaded.reason }

  return { ...draft, photos: [...draft.photos, uploaded.path] }
}

/** Drop one the rep thought better of, before it is ever attached to anything. */
async function removeIncidentPhoto(formData: FormData, target: string): Promise<ReportState> {
  await requireUnlocked()

  const kept = photoPaths(formData).filter((p) => p !== target)

  if (parseBookingFilePath(target)) {
    const supabase = await supabaseServer()
    await supabase.storage.from(BOOKING_FILES_BUCKET).remove([target])
  }

  return { ...draftOf(formData), photos: kept }
}

/**
 * Send it to the boss.
 *
 * The incident row and its photo rows are written here, from paths that are
 * already in the bucket — so this submission carries text and ids, never
 * megabytes. Every path is re-parsed and checked to belong to the booking
 * being reported on: a path is a client-supplied string like any other, and
 * the fact that the upload action produced it a moment ago is not something
 * this action can take on trust.
 *
 * A report with neither words nor photographs is refused. Everything else is
 * the rep's to phrase — there is no type to choose and nothing to price
 * (docs/01-DECISIONS.md §14).
 */
async function sendIncident(formData: FormData): Promise<ReportState> {
  const staff = await requireUnlocked()

  const draft = { ...draftOf(formData), photos: photoPaths(formData) }
  const parsed = z.object({
    booking_id: uuidSchema,
    note: z.string().trim().max(2000).transform((v) => v || null),
  }).safeParse({
    booking_id: formData.get('booking_id'),
    note: formData.get('note'),
  })
  if (!parsed.success) return { ...draft, error: 'IR104' }

  const { booking_id: bookingId, note } = parsed.data
  if (!note && draft.photos.length === 0) return { ...draft, error: 'incidentEmpty' }

  const mine = draft.photos.filter((path) => {
    const p = parseBookingFilePath(path)
    return p !== null && p.kind === 'incidents' && p.bookingId === bookingId
  })

  const supabase = await supabaseServer()
  const { data: incident, error } = await supabase.from('incidents')
    .insert({ booking_id: bookingId, note, raised_by: staff.id })
    .select('id').single()

  if (error || !incident) return { ...draft, error: errorKey(error) }

  if (mine.length > 0) {
    const { error: photoError } = await supabase.from('incident_photos').insert(
      mine.map((path) => ({ incident_id: incident.id, path, added_by: staff.id })))
    // The words are already with the boss; a photo row that would not write is
    // worth telling the rep about, not worth throwing the report away over.
    if (photoError) return { saved: true, photoError: errorKey(photoError) }
  }

  revalidatePath('/incidents')
  revalidatePath(`/bookings/${bookingId}`)
  redirect('/incidents?sent=1')
}

/** The draft's photos, as the form carries them between submissions. */
function photoPaths(formData: FormData): string[] {
  return formData.getAll('photos')
    .map((v) => String(v))
    .filter((v) => parseBookingFilePath(v) !== null)
}

/** What the rep has written so far, to hand straight back to the form. */
function draftOf(formData: FormData): { note: string; bookingId: string } {
  return {
    note: String(formData.get('note') ?? ''),
    bookingId: String(formData.get('booking_id') ?? ''),
  }
}

/**
 * The one action the form posts to, dispatching on which button was pressed.
 *
 * A single action rather than three means a single piece of state — the draft's
 * photo paths, which every one of the three has to carry forward — and one
 * form, so the whole thing still works with JavaScript off: each button is a
 * plain submit with its own `intent`.
 */
export async function submitIncident(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const intent = String(formData.get('intent') ?? '')

  if (intent === 'add-photo') return addIncidentPhoto(formData)
  // A remove button names the photo it means in its own value, so that one
  // button is the whole control — no hidden field to set, and nothing that
  // needs script to work.
  if (intent.startsWith('remove-photo:')) {
    return removeIncidentPhoto(formData, intent.slice('remove-photo:'.length))
  }
  return sendIncident(formData)
}
