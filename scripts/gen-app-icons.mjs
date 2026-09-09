/*
  Bubblewrap will not read an SVG, so the manifest's three PNGs are generated
  from src/app/icon.svg rather than drawn a second time by hand. Run it again
  if that badge ever changes: `node scripts/gen-app-icons.mjs`.

  The maskable variant is NOT the same image resized. Android crops a maskable
  icon to whatever shape the launcher uses and only guarantees the centre 80%
  circle, which would take the corners off a rounded square that fills its own
  viewBox. So it is redrawn: a full-bleed brand field with the wheel mark alone
  composited at ~60% of the width, well inside the safe circle.
*/
import sharp from 'sharp'

const BRAND = '#10456a'
const svg = 'src/app/icon.svg'

// The mark on its own, transparent, cropped to its own ink: x 10–54, y 20–51
// of the 64-unit viewBox (the strokes are 4 wide, so the path's 12/52 and
// 24/47 extremes reach a couple of units further than the coordinates say).
const mark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 44 31">
  <path d="M12 39h40M17 39l4-11a5 5 0 0 1 4.7-3.4h12.6A5 5 0 0 1 43 28l4 11" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="22" cy="43" r="4" fill="#ffffff"/>
  <circle cx="42" cy="43" r="4" fill="#ffffff"/>
</svg>`)

for (const size of [192, 512]) {
  await sharp(svg, { density: 600 }).resize(size, size).png().toFile(`public/icon-${size}.png`)
}

const SIZE = 512
const markWidth = Math.round(SIZE * 0.6)
const markPng = await sharp(mark, { density: 1200 }).resize({ width: markWidth }).png().toBuffer()
const { height: markHeight } = await sharp(markPng).metadata()

await sharp({
  create: { width: SIZE, height: SIZE, channels: 4, background: BRAND },
})
  .composite([{
    input: markPng,
    left: Math.round((SIZE - markWidth) / 2),
    top: Math.round((SIZE - markHeight) / 2),
  }])
  .png()
  .toFile('public/icon-maskable-512.png')

console.log('wrote public/icon-192.png, icon-512.png, icon-maskable-512.png')
