import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The same '@/…' the app and tsconfig use, so a test can import a module
      // without rewriting its imports.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws on import outside a React Server Component, which
      // is exactly what it is for — and which would otherwise put every
      // server-side module (the contract renderer, the storage helpers) out of
      // reach of a test. Stubbed here and only here; the real package still
      // guards the app.
      'server-only': fileURLToPath(new URL('./tests/helpers/server-only.ts', import.meta.url)),
    },
  },
  test: {
    globalSetup: ['./tests/globalSetup.ts'],
    include: ['tests/**/*.test.ts'],
    // Starting Postgres and cloning a database per file is measured in seconds,
    // not milliseconds.
    testTimeout: 30_000,
    hookTimeout: 90_000,
    pool: 'forks',
  },
})
