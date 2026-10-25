import { BlockList, isIP } from 'node:net'

/**
 * Cloudflare's published edge ranges, fetched 2026-10-25 from
 * https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6.
 * Re-check occasionally; a stale list only means CF-Connecting-IP is not
 * trusted for a new range, and X-Real-IP (the CF edge) is used instead.
 */
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
]

const cloudflare = new BlockList()
for (const range of CLOUDFLARE_RANGES) {
  const [net, prefix] = range.split('/') as [string, string]
  cloudflare.addSubnet(net, Number(prefix), isIP(net) === 6 ? 'ipv6' : 'ipv4')
}

function inCloudflare(ip: string): boolean {
  const v = isIP(ip)
  return v !== 0 && cloudflare.check(ip, v === 6 ? 'ipv6' : 'ipv4')
}

/**
 * The connecting client's address, or 'unknown'.
 *
 * Never X-Forwarded-For: its first entry is whatever the client sent. Railway's
 * edge overwrites X-Real-IP with the address that connected to it, so that is
 * the trusted hop. If that hop is Cloudflare, the real visitor is in
 * CF-Connecting-IP (which only a Cloudflare address can have set). Works
 * direct to Railway and behind Cloudflare.
 */
export function clientIp(h: { get(name: string): string | null }): string {
  const real = h.get('x-real-ip')?.trim() ?? ''
  if (!real || isIP(real) === 0) return 'unknown'
  if (inCloudflare(real)) {
    const cf = h.get('cf-connecting-ip')?.trim() ?? ''
    if (isIP(cf) !== 0) return cf
  }
  return real
}
