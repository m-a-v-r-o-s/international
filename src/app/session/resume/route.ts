import { NextResponse, type NextRequest } from 'next/server'
import { currentStaff } from '@/lib/auth/session'
import { establishSession } from '@/lib/auth/signin'
import { absoluteUrl } from '@/lib/http/publicUrl'

/**
 * A session that outlived its gate cookie — the app reopened, or the cookie
 * expired while the Supabase refresh token did not. Re-reads the profile,
 * re-issues the gate (locked, for a rep) and sends the request where it was
 * going. Only ever an internal path, so a crafted `next` cannot bounce someone
 * off to another site.
 */
export async function GET(request: NextRequest) {
  const staff = await currentStaff()

  if (!staff) {
    return NextResponse.redirect(absoluteUrl(request, '/login'))
  }

  await establishSession(staff.id)

  const next = request.nextUrl.searchParams.get('next')
  const path = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
  return NextResponse.redirect(absoluteUrl(request, path))
}
