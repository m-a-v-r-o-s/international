'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'

/**
 * A8 · Hotels. A hotel is a location a rep is stationed at
 * (docs/01-DECISIONS.md §3) and the thing a booking belongs to, so these rows
 * are load-bearing for the cover-shift rule even though nothing here writes
 * `hotel_reps` directly.
 *
 * Writes land on the `hotels_admin_write` policy, which re-checks
 * app.is_admin() in the database. requireAdmin() is the second lock.
 */
export type HotelFormState = { error?: ErrorKey; saved?: boolean } | undefined

const uuidSchema = z.string().uuid()
const nameSchema = z.string().trim().min(1).max(160)

function optionalText(max: number) {
  return z.string().trim().max(max).nullable().transform((v) => (v === '' || v === null ? null : v))
}

const hotelFields = z.object({
  name: nameSchema,
  area: optionalText(120),
  address: optionalText(300),
})

function readFields(formData: FormData) {
  return {
    name: formData.get('name'),
    area: (formData.get('area') as string | null) ?? null,
    address: (formData.get('address') as string | null) ?? null,
  }
}

export async function createHotel(
  _prev: HotelFormState, formData: FormData,
): Promise<HotelFormState> {
  await requireAdmin()

  const parsed = hotelFields.safeParse(readFields(formData))
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('hotels').insert(parsed.data)
  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/hotels')
  return { saved: true }
}

export async function updateHotel(
  _prev: HotelFormState, formData: FormData,
): Promise<HotelFormState> {
  await requireAdmin()

  const parsed = hotelFields.extend({ id: uuidSchema })
    .safeParse({ ...readFields(formData), id: formData.get('id') })
  if (!parsed.success) return { error: 'IR104' }

  const { id, ...fields } = parsed.data
  const supabase = await supabaseServer()
  const { error } = await supabase.from('hotels').update(fields).eq('id', id)
  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/hotels')
  return { saved: true }
}

/**
 * The same rule as a rep: deactivate rather than delete, so the bookings that
 * belong to the hotel keep pointing somewhere. A deactivated hotel disappears
 * from public.staff_hotels() — so no new booking can be made against it — and
 * stays on every booking that already names it. The `hotel_reps` rows survive
 * too, which is what keeps a rep able to read their own history there.
 */
export async function setHotelActive(
  _prev: HotelFormState, formData: FormData,
): Promise<HotelFormState> {
  await requireAdmin()

  const parsed = z.object({ id: uuidSchema, active: z.enum(['true', 'false']) })
    .safeParse({ id: formData.get('id'), active: formData.get('active') })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('hotels')
    .update({ active: parsed.data.active === 'true' })
    .eq('id', parsed.data.id)
  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/hotels')
  return { saved: true }
}

/**
 * A real delete, for a hotel typed in by mistake and never used. The database
 * decides whether that is what this is: `bookings.hotel_id` has no ON DELETE
 * clause, so a hotel with any booking against it raises 23503 and errorKey()
 * turns that into "this hotel is in use" — which tells the boss to deactivate
 * it instead. `hotel_reps` cascades, so a hotel with only assignments on it is
 * still removable, and the assignments go with it.
 */
export async function deleteHotel(
  _prev: HotelFormState, formData: FormData,
): Promise<HotelFormState> {
  await requireAdmin()

  const id = uuidSchema.safeParse(formData.get('id'))
  if (!id.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('hotels').delete().eq('id', id.data)
  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/hotels')
  revalidatePath('/admin/users')
  return { saved: true }
}
