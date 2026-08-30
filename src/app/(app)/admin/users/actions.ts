'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { createRepAccount, resetRepPassword } from '@/lib/users/accounts'
import { allow } from '@/lib/rate-limit'

/**
 * A8 · Users. Every action re-checks the role twice over: requireAdmin() at
 * the app boundary, and then the database itself — either through an
 * admin-only RPC that calls app.assert_admin(), or through a policy that
 * re-checks app.is_admin(). A hidden button is not a control
 * (docs/03-SECURITY.md, rule 5).
 */
export type UserFormState = {
  error?: ErrorKey
  saved?: boolean
  /**
   * Shown ONCE, at the moment of creation or re-issue, and never stored,
   * logged or re-derivable. It lives in the action's return value — which is
   * this response and nothing else — rather than in any row we own.
   */
  password?: string
  createdName?: string
} | undefined

const uuidSchema = z.string().uuid()
const emailSchema = z.string().trim().toLowerCase().email().max(254)
const nameSchema = z.string().trim().min(1).max(120)
const langSchema = z.enum(['el', 'en'])
const phoneSchema = z.string().trim().max(32).transform((v) => (v === '' ? null : v)).nullable()

/**
 * The database-side authorisation check that stands in front of the service
 * role, and the duplicate-address check in one call.
 *
 * public.admin_list_users() asserts app.is_admin() itself, so asking it
 * through the CALLER'S session is a real answer from Postgres about this JWT —
 * not a second copy of the rule in a route handler. Only once it has answered
 * does src/lib/users/accounts.ts touch the GoTrue Admin API.
 */
async function staffEmails(): Promise<{ emails: Set<string> } | { error: ErrorKey }> {
  const supabase = await supabaseServer()
  const { data, error } = await supabase.rpc('admin_list_users')
  if (error) return { error: errorKey(error) }
  return {
    emails: new Set(
      ((data ?? []) as { email: string | null }[])
        .map((r) => r.email?.toLowerCase())
        .filter((e): e is string => Boolean(e)),
    ),
  }
}

export async function createRep(_prev: UserFormState, formData: FormData): Promise<UserFormState> {
  const admin = await requireAdmin()

  const parsed = z.object({
    email: emailSchema,
    full_name: nameSchema,
    lang: langSchema,
  }).safeParse({
    email: formData.get('email'),
    full_name: formData.get('full_name'),
    lang: formData.get('lang'),
  })
  if (!parsed.success) return { error: 'IR104' }

  // Account creation is the one action here that costs money at a provider and
  // cannot be undone by a policy, so it gets its own cap.
  if (!(await allow(`user-create:${admin.id}`, 20, 3600))) return { error: 'rateLimited' }

  const known = await staffEmails()
  if ('error' in known) return { error: known.error }
  if (known.emails.has(parsed.data.email)) return { error: 'emailInUse' }

  const created = await createRepAccount({
    email: parsed.data.email,
    fullName: parsed.data.full_name,
    lang: parsed.data.lang,
    actorId: admin.id,
  })
  if (!created.ok) return { error: created.reason }

  revalidatePath('/admin/users')
  return { password: created.password, createdName: parsed.data.full_name }
}

export async function reissuePassword(
  _prev: UserFormState, formData: FormData,
): Promise<UserFormState> {
  const admin = await requireAdmin()

  const id = uuidSchema.safeParse(formData.get('id'))
  if (!id.success) return { error: 'IR104' }

  if (!(await allow(`user-reset:${admin.id}`, 20, 3600))) return { error: 'rateLimited' }

  // Same gate as createRep(), and the same reason: Postgres decides whether
  // this caller is an admin before the service-role key is touched. It also
  // proves the id names somebody who actually exists.
  const known = await staffEmails()
  if ('error' in known) return { error: known.error }

  const reset = await resetRepPassword({ profileId: id.data, actorId: admin.id })
  if (!reset.ok) return { error: reset.reason }

  revalidatePath(`/admin/users/${id.data}`)
  return { password: reset.password }
}

/** Name, phone and language. `role`, `active` and `pin_hash` are not here by design. */
export async function updateStaffDetails(
  _prev: UserFormState, formData: FormData,
): Promise<UserFormState> {
  await requireAdmin()

  const parsed = z.object({
    id: uuidSchema,
    full_name: nameSchema,
    phone: phoneSchema,
    lang: langSchema,
  }).safeParse({
    id: formData.get('id'),
    full_name: formData.get('full_name'),
    phone: (formData.get('phone') as string | null) ?? null,
    lang: formData.get('lang'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('profiles')
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone,
      lang: parsed.data.lang,
    })
    .eq('id', parsed.data.id)

  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${parsed.data.id}`)
  return { saved: true }
}

/**
 * Deactivate, never delete (docs/04-SCREENS.md A8): the bookings a rep created
 * still point at their profile, and `bookings.created_by` is what the
 * cover-shift rule reads. Deleting the row would take the history with it.
 * public.admin_set_user_active() refuses to act on the caller's own id
 * (IR113), so the boss cannot lock himself out.
 */
export async function setActive(_prev: UserFormState, formData: FormData): Promise<UserFormState> {
  await requireAdmin()

  const parsed = z.object({ id: uuidSchema, active: z.enum(['true', 'false']) }).safeParse({
    id: formData.get('id'),
    active: formData.get('active'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_set_user_active', {
    p_profile_id: parsed.data.id,
    p_active: parsed.data.active === 'true',
  })
  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${parsed.data.id}`)
  return { saved: true }
}

export async function setRole(_prev: UserFormState, formData: FormData): Promise<UserFormState> {
  await requireAdmin()

  const parsed = z.object({ id: uuidSchema, role: z.enum(['admin', 'rep']) }).safeParse({
    id: formData.get('id'),
    role: formData.get('role'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_set_user_role', {
    p_profile_id: parsed.data.id,
    p_role: parsed.data.role,
  })
  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${parsed.data.id}`)
  return { saved: true }
}

/**
 * THE ISOLATION BOUNDARY. `hotel_reps` is what app.my_hotel_ids() reads, and
 * that is what the §8 cover-shift rule is built on — so every row written here
 * changes who can see whose bookings, in both directions. Both writes go
 * through admin-only RPCs that do the whole movement in one transaction
 * (supabase/migrations/20260830140000_users_and_hotels.sql).
 */
export async function setHomeHotel(
  _prev: UserFormState, formData: FormData,
): Promise<UserFormState> {
  await requireAdmin()

  const raw = formData.get('hotel_id')
  const parsed = z.object({
    id: uuidSchema,
    hotel_id: uuidSchema.nullable(),
  }).safeParse({
    id: formData.get('id'),
    hotel_id: raw === '' || raw === null ? null : raw,
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_set_home_hotel', {
    p_profile_id: parsed.data.id,
    p_hotel_id: parsed.data.hotel_id,
  })
  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${parsed.data.id}`)
  revalidatePath('/admin/hotels')
  return { saved: true }
}

export async function setCover(_prev: UserFormState, formData: FormData): Promise<UserFormState> {
  await requireAdmin()

  const parsed = z.object({
    id: uuidSchema,
    hotel_id: uuidSchema,
    covers: z.enum(['true', 'false']),
  }).safeParse({
    id: formData.get('id'),
    hotel_id: formData.get('hotel_id'),
    covers: formData.get('covers'),
  })
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.rpc('admin_set_cover', {
    p_profile_id: parsed.data.id,
    p_hotel_id: parsed.data.hotel_id,
    p_covers: parsed.data.covers === 'true',
  })
  if (error) return { error: errorKey(error) }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${parsed.data.id}`)
  revalidatePath('/admin/hotels')
  return { saved: true }
}
