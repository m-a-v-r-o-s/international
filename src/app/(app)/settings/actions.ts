'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { subscriptionSchema } from '@/lib/push/keys'

/**
 * R8's notification half (docs/04-SCREENS.md R8, docs/01-DECISIONS.md §22).
 *
 * Two separate things, deliberately separate on screen as well as here:
 * whether THIS DEVICE is registered to receive pushes, and which KINDS of
 * message this person wants at all. Turning a kind off should not require
 * unregistering the phone, and unregistering the phone should not silently
 * forget the preferences.
 */
export type NotifyState = { error?: ErrorKey; saved?: boolean } | undefined

/**
 * Stores a browser's push subscription against the signed-in person.
 *
 * `profile_id` is never taken from the request — the `push_own` policy checks
 * `profile_id = auth.uid()` in the database, so a hand-crafted POST naming
 * somebody else's id is refused there rather than here. The endpoint is a URL
 * this server will later make requests to, so it is validated for shape,
 * scheme and length before it is stored (docs/03-SECURITY.md, "Input").
 */
export async function subscribeToPush(
  _prev: NotifyState, formData: FormData,
): Promise<NotifyState> {
  const staff = await requireUnlocked()

  let payload: unknown
  try {
    payload = JSON.parse(String(formData.get('subscription') ?? ''))
  } catch {
    return { error: 'IR104' }
  }

  const parsed = subscriptionSchema.safeParse(payload)
  if (!parsed.success) return { error: 'IR104' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('push_subscriptions').upsert({
    profile_id: staff.id,
    endpoint: parsed.data.endpoint,
    keys: parsed.data.keys,
  }, { onConflict: 'endpoint' })

  if (error) return { error: errorKey(error) }

  revalidatePath('/settings')
  return { saved: true }
}

export async function unsubscribeFromPush(
  _prev: NotifyState, formData: FormData,
): Promise<NotifyState> {
  await requireUnlocked()

  const endpoint = z.string().url().max(2000).safeParse(formData.get('endpoint'))
  if (!endpoint.success) return { error: 'IR104' }

  // The policy scopes the delete to the caller's own rows, so naming another
  // person's endpoint removes nothing.
  const supabase = await supabaseServer()
  const { error } = await supabase.from('push_subscriptions')
    .delete().eq('endpoint', endpoint.data)

  if (error) return { error: errorKey(error) }

  revalidatePath('/settings')
  return { saved: true }
}

/**
 * Which kinds this person wants. Only the admin kind is a preference at all —
 * a rep's two kinds are always on, not a choice, so there is no settings form
 * offering them and this refuses to write either column for a rep even if
 * called directly. app.profiles_before_write() clamps the same two columns
 * back to true in the database, so a forged request past this action still
 * cannot turn them off.
 */
export async function saveNotificationPreferences(
  _prev: NotifyState, formData: FormData,
): Promise<NotifyState> {
  const staff = await requireUnlocked()
  if (staff.role !== 'admin') return { error: 'forbidden' }

  const supabase = await supabaseServer()
  const { error } = await supabase.from('profiles').update({
    notify_incidents: formData.get('notify_incidents') === 'on',
  }).eq('id', staff.id)

  if (error) return { error: errorKey(error) }

  revalidatePath('/settings')
  return { saved: true }
}
