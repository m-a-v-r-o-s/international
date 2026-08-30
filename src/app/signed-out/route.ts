import { NextResponse, type NextRequest } from 'next/server'
import { clearSession } from '@/lib/auth/signin'

/**
 * Ends the session and says why. Reached when a rep's device binding no longer
 * matches — they signed in somewhere else, and this phone is no longer theirs
 * to use (docs/01-DECISIONS.md §1).
 */
export async function GET(request: NextRequest) {
  await clearSession()

  const reason = request.nextUrl.searchParams.get('reason')
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.search = reason === 'device' ? '?reason=device' : ''
  return NextResponse.redirect(url)
}
