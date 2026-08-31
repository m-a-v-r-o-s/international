// Node module hooks (registered by server-only-stub.mjs) that stand in for the
// `server-only` package when a lib module is run directly by tsx instead of
// bundled by Next. The real package throws unconditionally outside a bundler
// that sets the "react-server" export condition — see tests/helpers/server-only.ts
// for the same stub used under vitest, and why: the guard is a build-time
// concern that would otherwise put every server-side module out of reach of a
// plain Node script.
const STUB_URL = 'server-only-stub:noop'

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return { url: STUB_URL, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === STUB_URL) {
    return { format: 'module', shortCircuit: true, source: 'export {}' }
  }
  return nextLoad(url, context)
}
