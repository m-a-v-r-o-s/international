import { describe, expect, test } from 'vitest'
import { ZONES, zoneToPoint, pointToZone, clamp01, roundCoord } from '../../src/lib/damage/zones'

// The nine zones are what makes the car diagram reachable without a pointer:
// a mark can always be placed by name and is always described by name. If
// zoneToPoint() and pointToZone() ever disagree, a mark placed from the select
// would be read back as a different area — the text alternative would then be
// lying about where the damage is.

describe('zones round-trip', () => {
  test('every zone\'s centre reads back as that same zone', () => {
    for (const zone of ZONES) {
      const { x, y } = zoneToPoint(zone)
      expect(pointToZone(x, y)).toBe(zone)
    }
  })

  test('corners of the diagram land in the corner zones', () => {
    expect(pointToZone(0, 0)).toBe('topLeft')
    expect(pointToZone(1, 0)).toBe('topRight')
    expect(pointToZone(0, 1)).toBe('bottomLeft')
    expect(pointToZone(1, 1)).toBe('bottomRight')
    expect(pointToZone(0.5, 0.5)).toBe('midCentre')
  })

  test('an unknown zone falls back to the centre rather than off the diagram', () => {
    expect(zoneToPoint('nowhere' as never)).toEqual(zoneToPoint('midCentre'))
  })
})

describe('coordinates stay inside what the column accepts', () => {
  test('a tap outside the box is clamped into 0–1', () => {
    expect(clamp01(-0.4)).toBe(0)
    expect(clamp01(1.4)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0.5)
  })

  test('coordinates are rounded to the four decimals numeric(5,4) stores', () => {
    expect(roundCoord(0.123456)).toBe(0.1235)
    expect(roundCoord(1)).toBe(1)
    expect(roundCoord(0)).toBe(0)
  })
})
