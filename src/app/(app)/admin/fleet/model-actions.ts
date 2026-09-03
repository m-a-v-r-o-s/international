'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import {
  uploadModelPhoto, deleteModelPhoto, MAX_MODEL_PHOTO_BYTES,
} from '@/lib/storage/fleet-photos'

/**
 * Car models — created and edited on the FLEET screen, next to the plates that
 * belong to them, rather than in Settings beside the groups. A group is a
 * pricing and eligibility band the boss sets once a season; a model is part of
 * the fleet, and the screen that lists the fleet is where one gets added.
 * (The group half has its own screen at admin/categories/page.tsx.)
 *
 * `photoError` is separate from `error` for the same reason it is on a damage
 * mark: a model whose photo failed to upload is still a model, and losing the
 * specs the admin just typed because the picture was a 12 MB HEIC would be the
 * worse failure. The model is kept and the form says the photo did not attach.
 */
export type ModelState = { error?: ErrorKey; photoError?: ErrorKey; saved?: boolean } | undefined

const uuidSchema = z.string().uuid()
const nameSchema = z.string().trim().min(1).max(60)
const transmissionSchema = z.enum(['manual', 'automatic'])
const fuelSchema = z.enum(['petrol', 'diesel', 'hybrid', 'electric'])
const seatsSchema = z.coerce.number().int().min(1).max(9)
const doorsSchema = z.coerce.number().int().min(1).max(6)
const tankSchema = z.coerce.number().positive().max(999.9).nullable()

// Both nullable, and both bounded exactly as the CHECK constraints in
// 20260903120000_model_photos_and_engine.sql are. An electric model has no cc;
// a model whose brochure figure nobody has looked up yet still has to save.
const engineSchema = z.coerce.number().int().min(50).max(9999).nullable()
const powerSchema = z.coerce.number().int().min(1).max(2000).nullable()

/** The fields shared by create and update — declared once so the two cannot drift. */
const modelFields = {
  make: nameSchema,
  model: nameSchema,
  category_id: uuidSchema,
  transmission: transmissionSchema,
  fuel_type: fuelSchema,
  seats: seatsSchema,
  doors: doorsSchema,
  tank_litres: tankSchema,
  engine_cc: engineSchema,
  horsepower: powerSchema,
}

/**
 * Only the whitelisted fields are read out of the FormData and handed to the
 * insert — never the whole body — so a hand-crafted request cannot set a
 * column this form does not offer (docs/03-SECURITY.md, field tampering).
 */
function readFields(formData: FormData) {
  return {
    make: formData.get('make'),
    model: formData.get('model'),
    category_id: formData.get('category_id'),
    transmission: formData.get('transmission'),
    fuel_type: formData.get('fuel_type'),
    seats: formData.get('seats'),
    doors: formData.get('doors') || 5,
    tank_litres: formData.get('tank_litres') || null,
    engine_cc: formData.get('engine_cc') || null,
    horsepower: formData.get('horsepower') || null,
  }
}

function revalidate() {
  revalidatePath('/admin/fleet')
  revalidatePath('/availability')
}

export async function createModel(_prev: ModelState, formData: FormData): Promise<ModelState> {
  await requireAdmin()

  const parsed = z.object(modelFields).safeParse(readFields(formData))
  if (!parsed.success) return { error: 'IR104' }

  // A new model must arrive with a picture: R2 is a visual list, and a model
  // with no photo is a hole in it. An existing model may be saved without one
  // — see updateModel — because the seeded placeholder models predate the
  // bucket and must stay editable.
  const photo = formData.get('photo')
  if (!(photo instanceof File) || photo.size === 0) return { error: 'IR104' }
  if (photo.size > MAX_MODEL_PHOTO_BYTES) return { photoError: 'fileTooLarge' }

  const supabase = await supabaseServer()

  // The row is inserted first because the object path is keyed by the model's
  // own id, and because the bucket's insert policy checks that the model
  // actually exists before it will accept a file under it.
  const { data: model, error } = await supabase.from('car_models')
    .insert(parsed.data).select('id').single()
  if (error || !model) return { error: errorKey(error) }

  const uploaded = await uploadModelPhoto(supabase, {
    modelId: model.id,
    bytes: new Uint8Array(await photo.arrayBuffer()),
  })
  if (!uploaded.ok) {
    revalidate()
    return { saved: true, photoError: uploaded.reason }
  }

  const { error: linkError } = await supabase.from('car_models')
    .update({ photo_path: uploaded.path }).eq('id', model.id)
  if (linkError) {
    await deleteModelPhoto(supabase, uploaded.path)
    revalidate()
    return { saved: true, photoError: errorKey(linkError) }
  }

  revalidate()
  return { saved: true }
}

export async function updateModel(_prev: ModelState, formData: FormData): Promise<ModelState> {
  await requireAdmin()

  const parsed = z.object({ id: uuidSchema, ...modelFields }).safeParse({
    id: formData.get('id'),
    ...readFields(formData),
  })
  if (!parsed.success) return { error: 'IR104' }

  const { id, ...fields } = parsed.data
  const supabase = await supabaseServer()

  // The photo it has now, read before anything is written: this is both what
  // the replacement supersedes and what has to be deleted once the new one is
  // safely on the row.
  const { data: existing } = await supabase.from('car_models')
    .select('photo_path').eq('id', id).maybeSingle()

  const { error } = await supabase.from('car_models').update(fields).eq('id', id)
  if (error) return { error: errorKey(error) }

  // No file in the form means the admin edited the specs and left the picture
  // alone — not that they want it removed.
  const photo = formData.get('photo')
  if (!(photo instanceof File) || photo.size === 0) {
    revalidate()
    return { saved: true }
  }
  if (photo.size > MAX_MODEL_PHOTO_BYTES) {
    revalidate()
    return { saved: true, photoError: 'fileTooLarge' }
  }

  const uploaded = await uploadModelPhoto(supabase, {
    modelId: id,
    bytes: new Uint8Array(await photo.arrayBuffer()),
  })
  if (!uploaded.ok) {
    revalidate()
    return { saved: true, photoError: uploaded.reason }
  }

  const { error: linkError } = await supabase.from('car_models')
    .update({ photo_path: uploaded.path }).eq('id', id)
  if (linkError) {
    // The row still points at the old picture, so the new object is the
    // orphan and goes; the old one stays exactly where the screen expects it.
    await deleteModelPhoto(supabase, uploaded.path)
    revalidate()
    return { saved: true, photoError: errorKey(linkError) }
  }

  // Only now, with the new path committed to the row, is the old object
  // unreferenced and safe to remove.
  await deleteModelPhoto(supabase, existing?.photo_path)

  revalidate()
  return { saved: true }
}
