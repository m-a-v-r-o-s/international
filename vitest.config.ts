import { defineConfig } from 'vitest/config'

export default defineConfig({
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
