import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/session'

/**
 * The hotels half of A8 now lives inside A10 Settings (see
 * admin/settings/HotelsSection.tsx) so the sidebar keeps exactly one settings
 * entry — same move as /settings redirecting to /admin/settings for an admin.
 * This route survives only for old links and bookmarks.
 */
export default async function AdminHotelsPage() {
  await requireAdmin()
  redirect('/admin/settings#hotels-heading')
}
