import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

// WCAG 2.1 AA contrast, computed from the tokens rather than asserted beside
// them (HANDOFF.md: "Contrast, focus order, ARIA labels and keyboard paths are
// requirements, not polish").
//
// src/app/globals.css carries a ratio in a comment next to several colours.
// A comment is a claim; this is the check. It parses the real token values, so
// a future adjustment to a colour cannot quietly drop a pair below AA and
// leave a comment behind saying it did not.
//
// Thresholds (WCAG 2.1):
//   1.4.3 normal text            4.5:1
//   1.4.3 large text             3:1   (>= 24px, or >= 18.66px bold)
//   1.4.11 non-text UI parts     3:1   (borders, focus rings, control edges)

const CSS = readFileSync(resolve('src/app/globals.css'), 'utf8')

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(CSS)
  if (!match) throw new Error(`token --color-${name} not found in globals.css`)
  return match[1]!
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const full = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex
  const r = parseInt(full.slice(1, 3), 16)
  const g = parseInt(full.slice(3, 5), 16)
  const b = parseInt(full.slice(5, 7), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const WHITE = '#ffffff'

/** Foreground, background, what it is, and the threshold that applies. */
const TEXT_PAIRS: [string, string, string][] = [
  ['ink', 'surface', 'body text on a card'],
  ['ink', 'canvas', 'body text on the page'],
  ['ink', 'brand-tint', 'a quiet button, hovered'],
  ['brand', 'brand-tint', 'the current section in the side nav'],
  ['ink-soft', 'surface', 'hints and secondary text on a card'],
  ['ink-soft', 'canvas', 'hints and secondary text on the page'],
  ['brand', 'surface', 'a link on a card'],
  ['brand', 'canvas', 'a link on the page'],
  ['danger', 'surface', 'an error message'],
  ['danger', 'danger-tint', 'an error notice'],
  ['warn', 'surface', 'a warning'],
  ['warn', 'warn-tint', 'a warning notice'],
  ['ok', 'surface', 'a confirmation'],
  ['ok', 'ok-tint', 'a confirmation notice'],
]

describe('text meets AA at every size the app uses', () => {
  test.each(TEXT_PAIRS)('%s on %s — %s', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5)
  })

  test('white on every filled surface, including the 12px chips', () => {
    // The status chips on A8 and A9 are text-[0.75rem] font-bold — 12px, well
    // inside "normal text", so 3:1 is not enough for them.
    for (const bg of ['brand', 'brand-strong', 'danger', 'ok', 'ink-soft']) {
      expect(contrast(WHITE, token(bg)), `white on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('ink-faint is placeholder-only, and still clears AA where it is used', () => {
    // It appears as `placeholder:text-ink-faint` on .ir-field, which sits on
    // `surface`. A placeholder is not exempt from 1.4.3.
    expect(contrast(token('ink-faint'), token('surface'))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('non-text parts meet 1.4.11', () => {
  test('the focus ring is visible against both grounds', () => {
    // :focus-visible draws a 3px outline in --color-brand. If it were not
    // distinguishable from what it sits on, keyboard navigation would be
    // untrackable — which is why globals.css says never to remove it.
    for (const bg of ['surface', 'canvas', 'brand-tint']) {
      expect(contrast(token('brand'), token(bg)), `focus ring on ${bg}`)
        .toBeGreaterThanOrEqual(3)
    }
  })

  test('a control\'s own boundary reaches 3:1 on both grounds', () => {
    // THIS IS THE ONE THE AUDIT CAUGHT. .ir-field and .ir-btn-quiet used to
    // draw their border in --color-line, which is 1.39:1 on surface and
    // 1.29:1 on canvas — nowhere near 1.4.11's 3:1. A field is white on a
    // near-white page, so that border is the ONLY thing saying where the
    // control is. --color-control exists for exactly this and nothing else.
    for (const bg of ['surface', 'canvas']) {
      expect(contrast(token('control'), token(bg)), `control edge on ${bg}`)
        .toBeGreaterThanOrEqual(3)
    }
  })

  test('--color-line stays decorative, and is not held to 3:1', () => {
    // Card edges and list dividers carry no information: remove them and
    // every heading, label and value is still there and still in order.
    // 1.4.11 does not cover them, and darkening them to 3:1 would make an
    // operational screen shout. The check that matters is that they are not
    // being used as a control boundary, which is a code convention rather
    // than a colour — the two tokens are named apart so the choice is
    // deliberate at the call site.
    expect(contrast(token('line'), token('surface'))).toBeLessThan(3)
  })

  test('an invalid field is marked by more than its colour', () => {
    // 1.4.1: colour is never the only carrier. .ir-field[aria-invalid] turns
    // its border red, AND .ir-error prints the reason in words with an icon,
    // AND the input points at it through aria-describedby (src/components/
    // Field.tsx). This test pins the first of the three; the other two are
    // structural and are checked by reading the component.
    expect(contrast(token('danger'), token('surface'))).toBeGreaterThanOrEqual(3)
  })
})

describe('the ratios written in the tokens are true', () => {
  /**
   * globals.css annotates several colours with the ratio it claims against
   * `surface`. The claim is PARSED rather than repeated here, so there is one
   * copy of the number and a comment cannot go stale without this failing —
   * which is exactly what happened before this test existed: four of the seven
   * were wrong, all of them understating the real ratio.
   */
  function claimedRatios(): [string, number][] {
    const claims: [string, number][] = []
    for (const line of CSS.split('\n')) {
      const match = /--color-([a-z-]+):\s*#[0-9a-fA-F]{3,8};\s*\/\*\s*([\d.]+):1 on surface/
        .exec(line)
      if (match) claims.push([match[1]!, Number(match[2])])
    }
    return claims
  }

  test('every colour that claims one', () => {
    const claims = claimedRatios()
    // If the comments are ever removed wholesale, this test would silently
    // pass on an empty list.
    expect(claims.length).toBeGreaterThanOrEqual(7)

    for (const [name, claimed] of claims) {
      const actual = contrast(token(name), token('surface'))
      expect(Math.abs(actual - claimed), `--color-${name}: comment says ${claimed}:1, actual ${actual.toFixed(2)}:1`)
        .toBeLessThan(0.1)
    }
  })
})
