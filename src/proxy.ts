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
  //
  // Compared by host only, not full origin. Railway (like most reverse
  // proxies) terminates TLS at its edge and forwards internally over plain
  // HTTP, so request.nextUrl's own scheme is not trustworthy — comparing full
  // origins there rejected every real POST in production with a false "Bad
  // origin". The host a browser sends in `Origin` cannot be spoofed by an
  // attacker page, which is what this check actually needs to defend against;
  // the scheme a proxy chose to forward with is not part of that threat.
  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get('origin')
    if (origin) {
      const expectedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
      let originHost: string | null = null
      try { originHost = new URL(origin).host } catch { /* malformed Origin */ }
      if (!expectedHost || originHost !== expectedHost) {
        return new NextResponse('Bad origin', { status: 403 })
      }
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
    // Everything except Next's own image-optimization endpoint and any
    // request path that ends in a file extension — static files served
    // straight out of `public/` (images, sw.js, robots.txt, …) and generated
    // convention files (favicon.ico, icon.svg, …) alike. Those need no
    // session and no policy, and the login and 404 pages both hold images
    // that must render before, or without, a session.
    // `sw.js` matters here for a reason of its own: a browser re-fetches the
    // service worker on its own schedule, including while a rep's device is
    // PIN-locked, and this proxy would otherwise answer that fetch with a
    // redirect to /unlock. A service worker that fails to update is one that
    // keeps running the version it has for ever. The file is static JS with
    // no session in it, so there is nothing here to protect.
    '/((?!_next/image|.*\\.[\\w]+$).*)',
  ],
}
