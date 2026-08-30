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
