import type { NextRequest } from 'next/server'
import { isProduction } from '@/lib/env'

/**
 * Railway terminates TLS at its edge and forwards internally over plain HTTP
 * to whatever port the container happens to be listening on, so
 * `request.nextUrl`'s own origin is not trustworthy for building an absolute
 * redirect — it can come back as the container's internal address instead of
 * the public domain (same root cause as the CSRF host check in src/proxy.ts).
 * Build the origin from the forwarded header instead, and force https in
 * production rather than trusting the scheme Railway forwarded with.
 */
export function absoluteUrl(request: NextRequest, path: string): URL {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host
  const protocol = isProduction ? 'https' : request.nextUrl.protocol.replace(':', '')
  return new URL(path, `${protocol}://${host}`)
}
