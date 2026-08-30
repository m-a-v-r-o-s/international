import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { GATE_COOKIE, isUnlocked, readGate } from './lib/auth/gate'

/**
 * Three jobs, in this order: keep the Supabase session fresh, set the security
 * headers that vary per request, and turn away a navigation that has no
 * business being made.
 *
 * It is the outer layer only. Nothing here is the authority on access — the
 * pages and actions behind it re-check in the database, and RLS re-checks under
 * that. This exists so an unauthenticated phone gets a login screen instead of
 * a flash of an empty app.
 */
const PUBLIC_PATHS = ['/login', '/privacy', '/terms', '/signed-out', '/session/resume']

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── CSRF: a state-changing request has to come from us ────────────────────
  // Server Actions check this themselves, but not everything is an action, and
  // a second lock on the same door costs nothing.
  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get('origin')
    if (origin && origin !== request.nextUrl.origin) {
      return new NextResponse('Bad origin', { status: 403 })
    }
  }

  const nonce = crypto.randomUUID().replace(/-/g, '')
  const csp = contentSecurityPolicy(nonce)

  // Next reads the nonce back out of the request's CSP header and stamps it on
  // its own bootstrap scripts, which is what makes 'strict-dynamic' workable.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  let response = NextResponse.next({ request: { headers: requestHeaders } })

  // ── Session refresh ───────────────────────────────────────────────────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
          response = NextResponse.next({ request: { headers: requestHeaders } })
          response.headers.set('Content-Security-Policy', csp)
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, {
              ...options,
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
              path: '/',
            })
          }
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  response.headers.set('Content-Security-Policy', csp)

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (!user) {
    if (isPublic) return response
    return redirectTo(request, '/login', response)
  }

  if (pathname === '/login') return redirectTo(request, '/', response)
  if (isPublic) return response

  const gate = await readGate(
    request.cookies.get(GATE_COOKIE)?.value, process.env.SESSION_SECRET ?? '')

  // No gate yet — a restored session, or a first load after sign-in. Resume
  // reads the profile, issues the gate and sends the request on its way.
  if (!gate || gate.sub !== user.id) {
    return redirectTo(request, `/session/resume?next=${encodeURIComponent(pathname)}`, response)
  }

  // A rep's device stays locked between shifts; the admin's desktop does not
  // use a PIN at all (docs/01-DECISIONS.md §21).
  if (gate.role === 'rep' && !isUnlocked(gate) && pathname !== '/unlock') {
    return redirectTo(request, '/unlock', response)
  }

  return response
}

function redirectTo(request: NextRequest, path: string, from: NextResponse) {
  const url = request.nextUrl.clone()
  url.pathname = path.split('?')[0]!
  url.search = path.includes('?') ? `?${path.split('?')[1]}` : ''
  const response = NextResponse.redirect(url)
  // Carry over any refreshed session cookies rather than dropping them.
  for (const cookie of from.cookies.getAll()) response.cookies.set(cookie)
  return response
}

function contentSecurityPolicy(nonce: string): string {
  const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://localhost').origin
  const dev = process.env.NODE_ENV !== 'production'

  return [
    `default-src 'self'`,
    // 'strict-dynamic' lets Next's own bootstrap load the rest; the dev server
    // needs eval for hot reloading and never runs in production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${dev ? "'unsafe-eval'" : ''}`.trim(),
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: ${supabaseOrigin}`,
    `font-src 'self'`,
    `connect-src 'self' ${supabaseOrigin} ${dev ? 'ws: http://localhost:*' : ''}`.trim(),
    `media-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `worker-src 'self' blob:`,
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}

export const config = {
  matcher: [
    // Everything except Next's own assets and the files a browser fetches by
    // convention. Those need no session and no policy.
    // `sw.js` joins them for a reason of its own: a browser re-fetches the
    // service worker on its own schedule, including while a rep's device is
    // PIN-locked, and this proxy would answer that fetch with a redirect to
    // /unlock. A service worker that fails to update is one that keeps
    // running the version it has for ever. The file is static JS with no
    // session in it, so there is nothing here for the proxy to protect.
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|sw.js|robots.txt|sitemap.xml).*)',
  ],
}
