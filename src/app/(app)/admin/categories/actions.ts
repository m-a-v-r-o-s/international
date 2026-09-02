'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'

export type FormState = { error?: ErrorKey } | undefined

const uuidSchema = z.string().uuid()
const codeSchema = z.string().trim().min(1).max(4)
const nameSchema = z.string().trim().min(1).max(80)
const ageSchema = z.coerce.number().int().min(16).max(99)
const yearsSchema = z.coerce.number().int().min(0).max(20)
const sortSchema = z.coerce.number().int().min(0).max(999)

// Minimum ages are admin-editable data, never hard-coded in application logic
// (docs/01-DECISIONS.md §11) — this form is the only place they change.
export async function createCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    code: codeSchema,
    name_el: nameSchema,
    name_en: nameSchema,
    min_driver_age: ageSchema,
    min_licence_years: yearsSchema,
    sort_order: sortSchema,
  }).safeParse({
    code: formData.get('code'),
    name_el: formData.get('name_el'),
    name_en: formData.get('name_en'),
    min_driver_age: formData.get('min_driver_age'),
    min_licence_years: formData.get('min_licence_years'),
    sort_order: formData.get('sort_order'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('categories').insert(parsed.data)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/categories')
  return undefined
}

export async function updateCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    id: uuidSchema,
    code: codeSchema,
    name_el: nameSchema,
    name_en: nameSchema,
    min_driver_age: ageSchema,
    min_licence_years: yearsSchema,
    sort_order: sortSchema,
  }).safeParse({
    id: formData.get('id'),
    code: formData.get('code'),
    name_el: formData.get('name_el'),
    name_en: formData.get('name_en'),
    min_driver_age: formData.get('min_driver_age'),
    min_licence_years: formData.get('min_licence_years'),
    sort_order: formData.get('sort_order'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const { id, ...rest } = parsed.data
  const supabase = await supabaseServer()
  const { error } = await supabase.from('categories').update(rest).eq('id', id)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/categories')
  return undefined
}

const transmissionSchema = z.enum(['manual', 'automatic'])
const fuelSchema = z.enum(['petrol', 'diesel', 'hybrid', 'electric'])
const seatsSchema = z.coerce.number().int().min(1).max(9)
const doorsSchema = z.coerce.number().int().min(1).max(6)
const tankSchema = z.coerce.number().positive().max(999.9).nullable()

export async function createModel(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    make: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(60),
    category_id: uuidSchema,
    transmission: transmissionSchema,
    fuel_type: fuelSchema,
    seats: seatsSchema,
    doors: doorsSchema,
    tank_litres: tankSchema,
  }).safeParse({
    make: formData.get('make'),
    model: formData.get('model'),
    category_id: formData.get('category_id'),
    transmission: formData.get('transmission'),
    fuel_type: formData.get('fuel_type'),
    seats: formData.get('seats'),
    doors: formData.get('doors'),
    tank_litres: formData.get('tank_litres') || null,
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('car_models').insert(parsed.data)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/categories')
  revalidatePath('/admin/cars')
  return undefined
}

export async function updateModel(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin()

  const parsed = z.object({
    id: uuidSchema,
    make: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(60),
    category_id: uuidSchema,
    transmission: transmissionSchema,
    fuel_type: fuelSchema,
    seats: seatsSchema,
    doors: doorsSchema,
    tank_litres: tankSchema,
  }).safeParse({
    id: formData.get('id'),
    make: formData.get('make'),
    model: formData.get('model'),
    category_id: formData.get('category_id'),
    transmission: formData.get('transmission'),
    fuel_type: formData.get('fuel_type'),
    seats: formData.get('seats'),
    doors: formData.get('doors'),
    tank_litres: formData.get('tank_litres') || null,
  })
  if (!parsed.success) return { error: 'IR104' }

  const { id, ...rest } = parsed.data
  const supabase = await supabaseServer()
  const { error } = await supabase.from('car_models').update(rest).eq('id', id)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/categories')
  revalidatePath('/admin/cars')
  return undefined
}
