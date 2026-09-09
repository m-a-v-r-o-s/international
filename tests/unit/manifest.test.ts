import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import en from '../../messages/en.json'

// Bubblewrap generates the whole Android project from this one file, so its
// values become the app's values and a mistake here surfaces weeks later as a
// rejected Play upload rather than a failing build. Two failures are worth
// catching cheaply: an icon renamed or deleted out from under the manifest,
// and a manifest whose name/description has drifted from the app it names.
// The PNGs' contents are not tested; that is what looking at them is for.

const publicDir = new URL('../../public/', import.meta.url)
const manifest = JSON.parse(
  readFileSync(new URL('manifest.webmanifest', publicDir), 'utf8'),
) as {
  name: string
  short_name: string
  description: string
  start_url: string
  scope: string
  display: string
  background_color: string
  theme_color: string
  icons: { src: string; sizes: string; type: string; purpose?: string }[]
}

describe('public/manifest.webmanifest', () => {
  test('carries every field Bubblewrap reads', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.display).toBe('standalone')
    // Both are lifted from globals.css (--color-brand, --color-canvas) and
    // theme_color also has to match the viewport export in layout.tsx.
    expect(manifest.theme_color).toBe('#10456a')
    expect(manifest.background_color).toBe('#f4f6f8')
  })

  test('names icons that exist, at the sizes Play and Android need', () => {
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/'), icon.src).toBe(true)
      expect(existsSync(new URL(`.${icon.src}`, publicDir)), icon.src).toBe(true)
    }

    const bySize = manifest.icons.map((i) => `${i.sizes}${i.purpose ? ` ${i.purpose}` : ''}`)
    expect(bySize).toContain('192x192')
    expect(bySize).toContain('512x512')
    expect(bySize).toContain('512x512 maskable')
  })

  test('has not drifted from the English catalogue', () => {
    // A manifest is one static file served before any session exists, so there
    // is no user to have a language and hard-coded English is correct here.
    // Keeping it equal to en.json is what stops the two saying different things.
    expect(manifest.name).toBe(en.app.name)
    expect(manifest.short_name).toBe(en.app.short)
    expect(manifest.description).toBe(en.app.description)
  })
})
