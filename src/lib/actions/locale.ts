'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { LOCALE_COOKIE, LOCALES } from '@/i18n/locale'
import { currentStaff } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { isProduction } from '@/lib/env'

const schema = z.enum(LOCALES)

export async function setLocale(formData: FormData): Promise<void> {
  const parsed = schema.safeParse(formData.get('locale'))
  if (!parsed.success) return

  const store = await cookies()
  store.set(LOCALE_COOKIE, parsed.data, {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })

  // Signed in? Then the preference belongs to the person, not the browser, and
  // follows them to the boss's desktop. RLS limits this write to their own row.
  const staff = await currentStaff()
  if (staff) {
    const supabase = await supabaseServer()
    await supabase.from('profiles').update({ lang: parsed.data }).eq('id', staff.id)
  }

  revalidatePath('/', 'layout')
}
