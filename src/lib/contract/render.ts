import 'server-only'

import { access } from 'node:fs/promises'
import { join } from 'node:path'
import React from 'react'
import { Font, renderToBuffer } from '@react-pdf/renderer'
import { ContractDocument } from './document'
import { contractLabels } from './labels'
import type { ContractData } from './data'

/**
 * Rendering the agreement to bytes, server-side.
 *
 * THE FONT IS THE WHOLE PROBLEM. The PDF base-14 fonts have no Greek glyph
 * coverage at all, so a document that is Greek by decision (§16, §24) needs an
 * embedded font with real Greek. And it cannot be fetched: src/proxy.ts sets
 * `font-src 'self'`, which blocks a CDN font outright, and `script-src` is
 * nonce + strict-dynamic with no unsafe-eval in production — so any approach
 * that pulled a font or eval'd a template in the browser would work in `next
 * dev` and fail silently on Railway.
 *
 * Both halves of that are avoided by not being in a browser at all. Noto Sans
 * (Latin/Greek/Cyrillic, SIL Open Font License — assets/fonts/OFL.txt) is
 * committed to the repo and read off disk here, and @react-pdf/renderer
 * subsets it into the file. No network at render time and no client-side
 * generator.
 */
const FONT_DIR = join(process.cwd(), 'assets', 'fonts')

let registered = false

async function registerFonts(): Promise<void> {
  if (registered) return

  const regular = join(FONT_DIR, 'NotoSans-Regular.ttf')
  const bold = join(FONT_DIR, 'NotoSans-Bold.ttf')

  // Fail here, loudly, rather than three frames deep inside the renderer with
  // a message about a missing glyph: a deployment that did not ship the fonts
  // cannot produce a Greek contract, and that is worth saying plainly.
  await Promise.all([access(regular), access(bold)])

  Font.register({
    family: 'NotoSans',
    fonts: [
      { src: regular, fontWeight: 400 },
      { src: bold, fontWeight: 700 },
    ],
  })

  // Greek and English words break where any other Latin-script text does; the
  // default hyphenation callback would insert hyphens inside a licence number
  // or a plate, which is worse than a long line.
  Font.registerHyphenationCallback((word) => [word])

  registered = true
}

export async function renderContractPdf(data: ContractData): Promise<Uint8Array> {
  await registerFonts()
  const element = React.createElement(ContractDocument, { data, labels: contractLabels() })
  return new Uint8Array(await renderToBuffer(element as Parameters<typeof renderToBuffer>[0]))
}
