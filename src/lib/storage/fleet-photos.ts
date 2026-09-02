import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../supabase/database.types'
import type { ErrorKey } from '../errors'
import { sniffType, extensionFor, IMAGE_TYPES } from './sniff'

/**
 * The public `fleet-photos` bucket — one picture per car model.
 *
 *     <model_id>/<random>.<ext>
 *
 * The counterpart to src/lib/storage/paths.ts, and deliberately a much smaller
 * module, because this bucket carries a much smaller rule. A booking file's
 * path IS its authorisation key and every segment is load-bearing; a model
 * photo is a picture of a car parked in public, and the only question the
 * policies ask is whether the caller is the admin
 * (supabase/migrations/20260903120000_model_photos_and_engine.sql).
 *
 * What that migration and this module share is the SHAPE of the name. The
 * insert policy reads segment 1 as the model id and refuses a name that is not
 * exactly two segments, so the two files are halves of one rule and neither
 * may change alone.
 *
 * The basename is random on every upload rather than fixed. The bucket is
 * public and therefore CDN-cached: writing a replacement to the same name
 * would serve the old picture from the edge until it expired. A new name is a
 * new URL, and replaceModelPhoto() deletes the object it superseded.
 */
export const FLEET_PHOTOS_BUCKET = 'fleet-photos'

/** 5 MB — half the booking-files cap. One photo, chosen once, at a desk. */
export const MAX_MODEL_PHOTO_BYTES = 5 * 1024 * 1024

export type PhotoFailure = Extract<ErrorKey, 'fileType' | 'fileTooLarge' | 'unknown'>
export type PhotoOutcome = { ok: true; path: string } | { ok: false; reason: PhotoFailure }

type Client = SupabaseClient<Database>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASENAME = /^[a-f0-9]{16}\.(jpg|png|webp)$/

/** `<model_id>/<random>.<ext>` — the only place this string is built. */
export function modelPhotoPath(modelId: string, extension: string): string {
  if (!UUID.test(modelId)) throw new Error('modelPhotoPath: model id must be a uuid')
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  return `${modelId}/${random}.${extension}`
}

/**
 * The inverse, and the guard on anything read back off a row. A stored path is
 * accepted only if it is two segments, the first a uuid and the second one of
 * our own random basenames — so a value that arrived from anywhere but
 * modelPhotoPath() is a plain null rather than something to hand to the
 * storage API or interpolate into a URL.
 */
export function parseModelPhotoPath(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null
  const parts = path.split('/')
  if (parts.length !== 2) return null
  const [modelId, basename] = parts as [string, string]
  if (!UUID.test(modelId) || !BASENAME.test(basename)) return null
  return modelId
}

/**
 * The public URL for a stored model photo, or null.
 *
 * No signing and no round trip: the bucket is public, so this is string
 * construction, which is what lets R2 render sixteen model cards without
 * sixteen calls to the storage API. The path is validated first all the same —
 * a row whose photo_path did not come from modelPhotoPath() renders the
 * fallback tile rather than putting an unchecked string in an `src`.
 */
export function modelPhotoUrl(supabase: Client, path: string | null | undefined): string | null {
  if (!parseModelPhotoPath(path)) return null
  const { data } = supabase.storage.from(FLEET_PHOTOS_BUCKET).getPublicUrl(path as string)
  return data?.publicUrl ?? null
}

/**
 * Put one model photo in the bucket.
 *
 * `bytes` is read before anything else happens, because the size cap and the
 * type whitelist are decided from the CONTENT and never from what the browser
 * claimed the file was (docs/03-SECURITY.md). PDFs are excluded here — unlike
 * a contract, a car photo is an image or it is nothing.
 *
 * `supabase` is always the caller's own session client, never the service
 * role, so a rep who reached this code by any route is refused by the bucket's
 * insert policy rather than by a check in application code that could drift.
 */
export async function uploadModelPhoto(
  supabase: Client,
  input: { modelId: string; bytes: Uint8Array },
): Promise<PhotoOutcome> {
  if (input.bytes.byteLength === 0) return { ok: false, reason: 'fileType' }
  if (input.bytes.byteLength > MAX_MODEL_PHOTO_BYTES) return { ok: false, reason: 'fileTooLarge' }

  const sniffed = sniffType(input.bytes)
  if (!sniffed || !IMAGE_TYPES.includes(sniffed)) return { ok: false, reason: 'fileType' }

  const path = modelPhotoPath(input.modelId, extensionFor(sniffed))

  const { error } = await supabase.storage.from(FLEET_PHOTOS_BUCKET).upload(path, input.bytes, {
    contentType: sniffed,
    // Never an upsert: every path is new, so an upload that collided would
    // mean a uuid collision, and overwriting on one is not the recovery.
    upsert: false,
  })
  if (error) return { ok: false, reason: 'unknown' }

  return { ok: true, path }
}

/**
 * Delete the object a row used to point at.
 *
 * Best-effort by design, and called only AFTER the new path is safely on the
 * row: a model card showing a picture that no longer exists is a broken
 * screen, while a stale object nobody references is a few kilobytes. So a
 * failure here is swallowed rather than surfaced — the admin replaced the
 * photo, and they did.
 */
export async function deleteModelPhoto(
  supabase: Client, path: string | null | undefined,
): Promise<void> {
  if (!parseModelPhotoPath(path)) return
  await supabase.storage.from(FLEET_PHOTOS_BUCKET).remove([path as string])
}
