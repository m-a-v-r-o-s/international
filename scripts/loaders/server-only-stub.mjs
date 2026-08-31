// Preloaded via `tsx --import` to register server-only-stub-hooks.mjs before
// the target script's own imports resolve.
import { register } from 'node:module'

register('./server-only-stub-hooks.mjs', import.meta.url)
