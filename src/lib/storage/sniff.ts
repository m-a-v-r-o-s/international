/**
 * What a file actually is, read from its first bytes.
 *
 * docs/03-SECURITY.md: "whitelist image MIME types by sniffing content". A
 * client-supplied `type` on a File is a hint typed by the browser from the
 * extension, and an attacker sets it to whatever they like — so it decides
 * nothing here. The bucket carries the same whitelist as a second layer
 * (`allowed_mime_types`), and the storage API applies it independently.
 */
export type SniffedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) =>
  sig.every((byte, i) => bytes[offset + i] === byte)

export function sniffType(bytes: Uint8Array): SniffedType | null {
  if (bytes.length < 12) return null

  // JPEG · SOI marker. PNG · the 8-byte signature including the CRLF trap.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  // WebP · a RIFF container whose form type is WEBP; the four length bytes in
  // between are not part of the signature.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'

  return null
}

/** The extension the bucket path gets — derived from the sniff, never from the upload. */
export function extensionFor(type: SniffedType): string {
  switch (type) {
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    case 'application/pdf': return 'pdf'
  }
}

export const IMAGE_TYPES: SniffedType[] = ['image/jpeg', 'image/png', 'image/webp']
