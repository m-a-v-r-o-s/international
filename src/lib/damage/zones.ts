/**
 * Nine named zones over the car diagram.
 *
 * `damage_marks.x` / `.y` are relative 0–1 coordinates, which a tap produces
 * naturally and a keyboard cannot produce at all. So every mark can also be
 * placed — and is always described — by the zone it falls in: "front, upper
 * left" rather than "(0.31, 0.18)". That is what makes the diagram reachable
 * without a pointer and readable without sight, and it is the text alternative
 * the marks list is built from (WCAG 2.1 AA).
 *
 * Placing by zone stores the zone's centre. Placing by tap stores the exact
 * point the rep touched and reports the zone it landed in; the stored
 * coordinate is never rounded to the zone, because the rep pointed at
 * something specific.
 */
export const ZONES = [
  'topLeft', 'topCentre', 'topRight',
  'midLeft', 'midCentre', 'midRight',
  'bottomLeft', 'bottomCentre', 'bottomRight',
] as const

export type Zone = (typeof ZONES)[number]

const BANDS = [1 / 6, 1 / 2, 5 / 6]

/** The centre of a zone — what "place it in the middle of that area" means. */
export function zoneToPoint(zone: Zone): { x: number; y: number } {
  const index = ZONES.indexOf(zone)
  const safe = index < 0 ? 4 : index
  return { x: BANDS[safe % 3]!, y: BANDS[Math.floor(safe / 3)]! }
}

/** Which zone a coordinate falls in, for describing a mark that was tapped. */
export function pointToZone(x: number, y: number): Zone {
  const band = (v: number) => (v < 1 / 3 ? 0 : v < 2 / 3 ? 1 : 2)
  return ZONES[band(y) * 3 + band(x)]!
}

/** Clamp a raw pointer coordinate into the 0–1 range the column check allows. */
export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5
  return Math.min(1, Math.max(0, v))
}

/** Four decimals — `damage_marks.x` and `.y` are numeric(5,4). */
export function roundCoord(v: number): number {
  return Math.round(clamp01(v) * 10_000) / 10_000
}
