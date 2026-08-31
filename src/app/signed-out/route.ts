import { NextResponse, type NextRequest } from 'next/server'
import { clearSession } from '@/lib/auth/signin'
import { absoluteUrl } from '@/lib/http/publicUrl'

/**
 * Ends the session and says why. Reached when a rep's device binding no longer
 * matches — they signed in somewhere else, and this phone is no longer theirs
 * to use (docs/01-DECISIONS.md §1).
 */
export async function GET(request: NextRequest) {
  await clearSession()

  const reason = request.nextUrl.searchParams.get('reason')
  const path = `/login${reason === 'device' ? '?reason=device' : ''}`
  return NextResponse.redirect(absoluteUrl(request, path))
}
