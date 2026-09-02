import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next 16 writes an AGENTS.md and a CLAUDE.md at the repo root on `next dev`.
  // This project's instructions live in HANDOFF.md and docs/ by design, and a
  // generated file claiming to be either would be a second, wrong source.
  agentRules: false,
  // The PDF renderer is a Node-only library with its own font and layout
  // engines. Bundling it would be slower and, worse, would risk a stray import
  // of it reaching a client chunk — where `font-src 'self'` and a
  // nonce/strict-dynamic `script-src` with no unsafe-eval (src/proxy.ts) would
  // break it in production while `next dev` looked fine.
  serverExternalPackages: ['@react-pdf/renderer'],
  // Every photo this app takes arrives through a Server Action — a licence,
  // the mark on a damage diagram, the guest's signature, the pictures on an
  // incident — and Next caps a Server Action body at 1 MB by default, above
  // which it throws a 413 before any of our code runs. A photo off a rep's
  // phone is 2–5 MB, so that default refused every real one.
  //
  // 12 MB is deliberately just ABOVE `MAX_UPLOAD_BYTES` (10 MB, in
  // src/lib/storage/booking-files.ts), not equal to it: the app's own cap
  // should be the thing that refuses an oversized file, because it refuses it
  // with a message in the rep's language and keeps whatever else they had
  // typed. A framework 413 is a dead page. The two numbers are a pair — moving
  // one without the other puts the wrong one in charge.
  experimental: {
    serverActions: { bodySizeLimit: '12mb' },
  },
  // A2 (fleet board) and A3 (car management) were merged into one /admin/fleet
  // screen, and car detail moved under it. These are the boss's bookmarks, so
  // the old paths answer rather than 404 — a rename inside the app, not a
  // public URL contract, hence permanent.
  async redirects() {
    return [
      { source: '/admin/fleet-board', destination: '/admin/fleet', permanent: true },
      { source: '/admin/cars', destination: '/admin/fleet', permanent: true },
      { source: '/admin/cars/:id', destination: '/admin/fleet/:id', permanent: true },
    ]
  },
  // Security headers that never vary per request live here; the ones that do
  // (the CSP nonce) are set in middleware.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        // The pickup flow photographs licences; nothing else is needed.
        {
          key: 'Permissions-Policy',
          value: [
            'camera=(self)', 'microphone=()', 'geolocation=()', 'payment=()',
            'usb=()', 'magnetometer=()', 'gyroscope=()', 'accelerometer=()',
            'interest-cohort=()',
          ].join(', '),
        },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ],
    }]
  },
}

export default withNextIntl(config)
