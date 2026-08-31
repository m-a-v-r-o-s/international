import { requireAdmin } from '@/lib/auth/session'

/**
 * Everything under /admin requires the admin role. requireAdmin() re-checks
 * this on every request; RLS re-checks it again underneath. A rep who guesses
 * one of these URLs gets redirected before a single query runs.
 *
 * The section list this layout used to carry now lives in the app shell
 * (src/app/(app)/layout.tsx → src/components/SideNav.tsx), where it is a
 * standing column on a desktop screen and a drawer on a phone.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  return <div className="flex flex-col gap-5">{children}</div>
}
