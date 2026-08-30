import { describe, expect, test } from 'vitest'
import {
  BOOKING_FILES_BUCKET, FILE_KINDS, REPLACEABLE_KINDS,
  bookingFilePath, bookingIdFromPath, parseBookingFilePath,
} from '../../src/lib/storage/paths'
import { extensionFor, sniffType } from '../../src/lib/storage/sniff'

// The object path is the authorisation key: the RLS policies in
// supabase/migrations/20260830120000_storage.sql read the booking out of
// segment 1 and the kind out of segment 2. So the builder and the parser have
// to agree with each other AND with storage.foldername(), and anything that is
// not exactly <booking>/<kind>/<file> has to come back as a plain null rather
// than something a caller can steer.

const BOOKING = '3f1d4a2e-9b7c-4c1e-8a2f-0d6e5b4c3a21'

describe('the path round-trips', () => {
  test('every kind builds and parses back to itself', () => {
    for (const kind of FILE_KINDS) {
      const path = bookingFilePath(BOOKING, kind, 'front.jpg')
      expect(path).toBe(`${BOOKING}/${kind}/front.jpg`)
      expect(parseBookingFilePath(path)).toEqual({
        bookingId: BOOKING, kind, filename: 'front.jpg',
      })
    }
  })

  test('the booking id is readable straight off the path', () => {
    expect(bookingIdFromPath(bookingFilePath(BOOKING, 'contract', 'a.pdf'))).toBe(BOOKING)
  })

  test('licence images sit under their own folder, so the purge can find exactly them', () => {
    // docs/01-DECISIONS.md §25 — the images go, the contract and signature stay.
    expect(bookingFilePath(BOOKING, 'licences', 'd-front.jpg').split('/')[1]).toBe('licences')
    expect(REPLACEABLE_KINDS).toEqual(['licences', 'damage'])
    expect(REPLACEABLE_KINDS).not.toContain('contract')
    expect(REPLACEABLE_KINDS).not.toContain('signature')
  })

  test('the bucket is named once', () => {
    expect(BOOKING_FILES_BUCKET).toBe('booking-files')
  })
})

describe('anything else is null, not a guess', () => {
  test.each([
    ['a bare filename', 'front.jpg'],
    ['no kind', `${BOOKING}/front.jpg`],
    ['nested too deep', `${BOOKING}/licences/2026/front.jpg`],
    ['an unknown kind', `${BOOKING}/notes/front.jpg`],
    ['a first segment that is not a uuid', 'someone/licences/front.jpg'],
    ['a traversal in the filename', `${BOOKING}/licences/..%2Fsecret.jpg`],
    ['a leading slash', `/${BOOKING}/licences/front.jpg`],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('%s', (_label, path) => {
    expect(parseBookingFilePath(path as string | null | undefined)).toBeNull()
    expect(bookingIdFromPath(path as string | null | undefined)).toBeNull()
  })

  test('the builder refuses to make an unsafe path in the first place', () => {
    expect(() => bookingFilePath('not-a-uuid', 'licences', 'a.jpg')).toThrow()
    expect(() => bookingFilePath(BOOKING, 'licences', '../escape.jpg')).toThrow()
    expect(() => bookingFilePath(BOOKING, 'licences', 'a/b.jpg')).toThrow()
    expect(() => bookingFilePath(BOOKING, 'licences', '')).toThrow()
  })
})

describe('what a file is, is read from the file', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1])
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
  const pdf = new Uint8Array([...Buffer.from('%PDF-1.7\n%\xe2\xe3', 'latin1')])

  test('the four types we accept are recognised by their magic bytes', () => {
    expect(sniffType(jpeg)).toBe('image/jpeg')
    expect(sniffType(png)).toBe('image/png')
    expect(sniffType(webp)).toBe('image/webp')
    expect(sniffType(pdf)).toBe('application/pdf')
  })

  test('anything else is null — a claimed content type decides nothing', () => {
    expect(sniffType(new Uint8Array(0))).toBeNull()
    expect(sniffType(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull()
    // An HTML page renamed .jpg, which is the whole reason sniffing exists.
    expect(sniffType(new Uint8Array(Buffer.from('<!doctype html><script>')))).toBeNull()
    // A RIFF container that is a WAV, not a WebP.
    expect(sniffType(new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull()
  })

  test('the extension follows the sniff, never the upload', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg')
    expect(extensionFor('image/png')).toBe('png')
    expect(extensionFor('image/webp')).toBe('webp')
    expect(extensionFor('application/pdf')).toBe('pdf')
  })
})
