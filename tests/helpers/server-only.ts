// Stands in for the `server-only` package under vitest (see vitest.config.ts).
// The real one throws on import so that a server module can never be pulled
// into a client bundle; that guard is a build-time concern and would otherwise
// make every server-side module untestable.
export {}
