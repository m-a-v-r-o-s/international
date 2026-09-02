import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/session'

/**
 * A3's categories & models half now lives inside A10 Settings (see
 * admin/settings/CategoriesSection.tsx) so the sidebar keeps exactly one
 * settings entry — same move as the hotels half before it. This route
 * survives only for old links and bookmarks.
 */
export default async function CategoriesPage() {
  await requireAdmin()
  redirect('/admin/settings#categories-heading')
}
