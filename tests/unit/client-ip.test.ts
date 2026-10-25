import { describe, expect, test } from 'vitest'
import { clientIp } from '../../src/lib/http/client-ip'

const hdr = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null })

describe('clientIp', () => {
  test('forged X-Forwarded-For is ignored', () => {
    expect(clientIp(hdr({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9')
    expect(clientIp(hdr({ 'x-forwarded-for': '1.2.3.4' }))).toBe('unknown')
  })
  test('Cloudflare X-Real-IP trusts CF-Connecting-IP', () => {
    expect(clientIp(hdr({ 'x-real-ip': '172.69.1.1', 'cf-connecting-ip': '198.51.100.7' }))).toBe('198.51.100.7')
    expect(clientIp(hdr({ 'x-real-ip': '2606:4700::1', 'cf-connecting-ip': '198.51.100.7' }))).toBe('198.51.100.7')
  })
  test('non-Cloudflare X-Real-IP wins over a forged CF-Connecting-IP', () => {
    expect(clientIp(hdr({ 'x-real-ip': '203.0.113.9', 'cf-connecting-ip': '198.51.100.7' }))).toBe('203.0.113.9')
  })
})
