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

/** ICU placeholders — {name}, and the argument of a plural/select block. */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]!).sort()
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
