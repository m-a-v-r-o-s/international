import { describe, expect, test } from 'vitest'
import { appleSpring, project, rubberband, springEasing, springTo, velocityTracker } from '@/lib/spring'

describe('spring primitives', () => {
  test('rubberband is capped by the dimension and keeps its sign', () => {
    expect(rubberband(1e9, 844)).toBeLessThan(844)
    expect(rubberband(-300, 844)).toBeLessThan(0)
  })
  test('project matches UIScrollView deceleration', () => {
    expect(project(1000)).toBeCloseTo(499, 6)
  })
  test('bounce maps to damping ratio 1 - bounce', () => {
    for (const [b, ratio] of [[0, 1], [0.15, 0.85], [0.3, 0.7]] as const) {
      const { stiffness, damping } = appleSpring(0.5, b)
      expect(damping / (2 * Math.sqrt(stiffness))).toBeCloseTo(ratio, 6)
    }
  })
  test('smooth never overshoots, bouncy does', () => {
    const peak = (b: number) => Math.max(...springEasing(0.5, b).easing.slice(7, -1).split(', ').map(Number))
    expect(peak(0)).toBeLessThanOrEqual(1)
    expect(peak(0.3)).toBeGreaterThan(1.02)
  })
  test('springTo settles on the target', async () => {
    const st = { x: 0, v: 0 }
    await new Promise<void>((done) => springTo(st, 100, { bounce: 0.15, onDone: done }))
    expect(st.x).toBe(100)
  })
  test('velocityTracker reads px/s', () => {
    const vt = velocityTracker(); vt.add(0, 0); vt.add(50, 50)
    expect(vt.get()).toBeCloseTo(1000, 6)
  })
})
