import type { DamageView } from '@/app/(app)/bookings/[id]/CarDiagram'

/**
 * The five car outlines, as DATA rather than as JSX.
 *
 * They are drawn twice now — on the screen with React DOM, and into the
 * contract PDF with @react-pdf/renderer's own SVG primitives, which are a
 * different renderer entirely. The same reasoning as src/lib/damage/zones.ts
 * applies: `damage_marks.x`/`.y` are relative 0–1 coordinates inside THIS
 * viewBox, so if the two renderers ever drew different boxes, a mark recorded
 * at pickup would sit somewhere else on the agreement the guest signs. One
 * source, two renderers, no drift.
 */
export const DIAGRAM_VIEWBOX = { width: 300, height: 200 }

export type DiagramShape =
  | { kind: 'path'; d: string }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number }

const SIDE: DiagramShape[] = [
  { kind: 'path', d: 'M18 128 L18 96 Q20 84 42 81 L92 50 Q104 43 126 43 L188 43 Q210 45 224 57 L258 80 Q280 85 282 98 L282 128 Z' },
  { kind: 'path', d: 'M100 78 L128 55 L166 55 L166 78 Z' },
  { kind: 'path', d: 'M176 55 L196 56 L220 78 L176 78 Z' },
  { kind: 'circle', cx: 82, cy: 128, r: 21 },
  { kind: 'circle', cx: 228, cy: 128, r: 21 },
]

const end = (rear: boolean): DiagramShape[] => [
  { kind: 'path', d: 'M52 146 L52 84 Q56 62 78 56 L104 44 L196 44 L222 56 Q244 62 248 84 L248 146 Z' },
  { kind: 'path', d: rear ? 'M92 58 L208 58 L200 92 L100 92 Z' : 'M96 58 L204 58 L214 94 L86 94 Z' },
  { kind: 'rect', x: 62, y: 104, width: 34, height: 18, rx: 6 },
  { kind: 'rect', x: 204, y: 104, width: 34, height: 18, rx: 6 },
  { kind: 'path', d: 'M108 132 L192 132' },
]

const TOP: DiagramShape[] = [
  { kind: 'path', d: 'M112 22 Q150 14 188 22 L206 44 Q222 70 222 100 Q222 130 206 156 L188 172 Q150 180 112 172 L94 156 Q78 130 78 100 Q78 70 94 44 Z' },
  { kind: 'path', d: 'M100 58 Q150 50 200 58' },
  { kind: 'path', d: 'M100 142 Q150 150 200 142' },
  { kind: 'rect', x: 104, y: 72, width: 92, height: 56, rx: 10 },
]

/** `mirrored` is the right-hand side: the same outline, flipped in place. */
export function shapesFor(view: DamageView): { shapes: DiagramShape[]; mirrored: boolean } {
  switch (view) {
    case 'left':  return { shapes: SIDE, mirrored: false }
    case 'right': return { shapes: SIDE, mirrored: true }
    case 'front': return { shapes: end(false), mirrored: false }
    case 'rear':  return { shapes: end(true), mirrored: false }
    case 'top':   return { shapes: TOP, mirrored: false }
  }
}

export const MIRROR_TRANSFORM = `translate(${DIAGRAM_VIEWBOX.width},0) scale(-1,1)`
