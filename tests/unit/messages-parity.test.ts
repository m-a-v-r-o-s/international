import { describe, expect, test } from 'vitest'
import el from '../../messages/el.json'
import en from '../../messages/en.json'

// "Greek and English from the first commit. No hard-coded user-facing strings,
// ever" (HANDOFF.md). A key that exists in one catalogue and not the other is
// a screen that renders a raw key in one language — which is exactly the
// failure retrofitting i18n was meant to avoid, arriving one commit at a time.

type Tree = { [key: string]: string | Tree }

function paths(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const here = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string' ? [here] : paths(value, here)
  })
}

/**
 * The ICU ARGUMENTS a message takes — `{name}`, and the argument a
 * plural/select block switches on.
 *
 * Brace depth is what separates an argument from a sub-message: `{n, plural,
 * =0 {None} ...}` opens `n` at depth 1 and `None` at depth 2, and only the
 * first is something a caller has to supply. A plain regex reads the second as
 * an argument too, and then reports every plural whose zero case happens to be
 * one Latin word in one language and not the other — which is a difference in
 * wording, not in interface.
 */
function placeholders(message: string): string[] {
  const found: string[] = []
  let depth = 0

  for (let i = 0; i < message.length; i++) {
    const char = message[i]
    if (char === '}') { depth--; continue }
    if (char !== '{') continue

    depth++
    if (depth !== 1) continue

    const rest = message.slice(i + 1)
    const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/.exec(rest)
    if (name) found.push(name[1]!)
  }

  return found.sort()
}

function flat(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const here = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(here, value)
    else for (const [k, v] of flat(value, here)) out.set(k, v)
  }
  return out
}

describe('el and en catalogues', () => {
  test('have exactly the same keys', () => {
    const elKeys = paths(el as Tree).sort()
    const enKeys = paths(en as Tree).sort()

    expect(enKeys.filter((k) => !elKeys.includes(k))).toEqual([])
    expect(elKeys.filter((k) => !enKeys.includes(k))).toEqual([])
  })

  test('take the same placeholders in both languages', () => {
    const elFlat = flat(el as Tree)
    const mismatched: string[] = []

    for (const [key, message] of flat(en as Tree)) {
      const other = elFlat.get(key)
      if (other === undefined) continue
      if (placeholders(message).join(',') !== placeholders(other).join(',')) mismatched.push(key)
    }

    expect(mismatched).toEqual([])
  })

  test('have no empty strings standing in for a translation', () => {
    for (const [key, message] of flat(el as Tree)) {
      expect(message.trim(), key).not.toBe('')
    }
  })
})
