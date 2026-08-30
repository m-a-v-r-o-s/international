'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'

export type FormState = { error?: ErrorKey; fieldErrors?: Record<string, string> } | undefined

const plateSchema = z.string().trim().min(2).max(16)
const yearSchema = z.coerce.number().int().min(1980).max(2100).nullable()
const colourSchema = z.string().trim().max(40).nullable()
const uuidSchema = z.string().uuid()

function optionalText(max: number) {
  return z.string().trim().max(max).nullable()
    .transform((v) => (v === '' || v === null ? null : v))
}

/** A3 · Add a car. Every field the admin may write, nothing the guard trigger would strip anyway. */
export async function createCar(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    plate: plateSchema,
    model_id: uuidSchema,
    year: yearSchema,
    colour: colourSchema,
  }).safeParse({
    plate: formData.get('plate'),
    model_id: formData.get('model_id'),
    year: formData.get('year') || null,
    colour: (formData.get('colour') as string | null)?.trim() || null,
  })

  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('cars').insert({
    plate: parsed.data.plate.toUpperCase(),
    model_id: parsed.data.model_id,
    year: parsed.data.year,
    colour: parsed.data.colour,
  })

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/cars')
  return undefined
}

export async function updateCar(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    id: uuidSchema,
    plate: plateSchema,
    model_id: uuidSchema,
    year: yearSchema,
    colour: colourSchema,
  }).safeParse({
    id: formData.get('id'),
    plate: formData.get('plate'),
    model_id: formData.get('model_id'),
    year: formData.get('year') || null,
    colour: (formData.get('colour') as string | null)?.trim() || null,
  })

  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('cars')
    .update({
      plate: parsed.data.plate.toUpperCase(),
      model_id: parsed.data.model_id,
      year: parsed.data.year,
      colour: parsed.data.colour,
    })
    .eq('id', parsed.data.id)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/cars')
  revalidatePath(`/admin/cars/${parsed.data.id}`)
  return undefined
}

/** Archive rather than delete by default — history stays intact (docs/01-DECISIONS.md §17). */
export async function archiveCar(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()
  const id = uuidSchema.safeParse(formData.get('id'))
  if (!id.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('cars')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id.data)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/cars')
  revalidatePath(`/admin/cars/${id.data}`)
  return undefined
}

export async function unarchiveCar(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()
  const id = uuidSchema.safeParse(formData.get('id'))
  if (!id.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('cars')
    .update({ archived_at: null })
    .eq('id', id.data)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/cars')
  revalidatePath(`/admin/cars/${id.data}`)
  return undefined
}

/** A real delete — only for a car that was never actually used (a data-entry mistake). */
export async function deleteCar(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()
  const id = uuidSchema.safeParse(formData.get('id'))
  if (!id.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('cars').delete().eq('id', id.data)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/cars')
  return undefined
}

/** Admin-only free text kept off `cars` entirely; reached only through the RPC. */
export async function setCarNotes(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    id: uuidSchema,
    notes: optionalText(2000),
  }).safeParse({
    id: formData.get('id'),
    notes: (formData.get('notes') as string | null) ?? null,
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_set_car_notes', {
    p_car_id: parsed.data.id,
    p_notes: parsed.data.notes,
  })

  if (error) return { error: errorKey(error) }

  revalidatePath(`/admin/cars/${parsed.data.id}`)
  return undefined
}

// ── Blocks ────────────────────────────────────────────────────────────────

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export async function createBlock(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    car_id: uuidSchema,
    start: dateSchema,
    end: dateSchema,
    reason: optionalText(500),
  }).safeParse({
    car_id: formData.get('car_id'),
    start: formData.get('start'),
    end: formData.get('end'),
    reason: (formData.get('reason') as string | null) ?? null,
  })
  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.end < parsed.data.start) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_create_block', {
    p_car_id: parsed.data.car_id,
    p_start: parsed.data.start,
    p_end: parsed.data.end,
    p_reason: parsed.data.reason,
  })

  if (error) return { error: errorKey(error) }

  revalidatePath(`/admin/cars/${parsed.data.car_id}`)
  return undefined
}

export async function updateBlock(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    id: uuidSchema,
    car_id: uuidSchema,
    start: dateSchema,
    end: dateSchema,
    reason: optionalText(500),
  }).safeParse({
    id: formData.get('id'),
    car_id: formData.get('car_id'),
    start: formData.get('start'),
    end: formData.get('end'),
    reason: (formData.get('reason') as string | null) ?? null,
  })
  if (!parsed.success) return { error: 'IR104' }
  if (parsed.data.end < parsed.data.start) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_update_block', {
    p_id: parsed.data.id,
    p_start: parsed.data.start,
    p_end: parsed.data.end,
    p_reason: parsed.data.reason,
  })

  if (error) return { error: errorKey(error) }

  revalidatePath(`/admin/cars/${parsed.data.car_id}`)
  return undefined
}

export async function deleteBlock(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({ id: uuidSchema, car_id: uuidSchema }).safeParse({
    id: formData.get('id'),
    car_id: formData.get('car_id'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_delete_block', { p_id: parsed.data.id })

  if (error) return { error: errorKey(error) }

  revalidatePath(`/admin/cars/${parsed.data.car_id}`)
  return undefined
}
