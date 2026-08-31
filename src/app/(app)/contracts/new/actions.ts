'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

/**
 * The picker's search, as a plain GET redirect — the same shape R6 uses, so
 * the URL stays shareable and the back button behaves.
 */
export async function searchUnsignedBookings(formData: FormData): Promise<void> {
  const query = z.string().trim().max(120).safeParse(formData.get('q'))
  const q = query.success ? query.data : ''
  redirect(q ? `/contracts/new?q=${encodeURIComponent(q)}` : '/contracts/new')
}
