import { ImageResponse } from 'next/og'

/**
 * The card that shows when someone shares a link to this app in a messaging
 * app. Generated rather than shipped as a binary so it stays in step with the
 * brand colours.
 */
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'International Rentals — operations'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 80,
          background: '#10456a',
          color: '#ffffff',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 34, opacity: 0.75, letterSpacing: 2 }}>OPERATIONS</div>
        <div style={{ fontSize: 92, fontWeight: 700, lineHeight: 1.05, marginTop: 12 }}>
          International Rentals
        </div>
        <div style={{ fontSize: 34, opacity: 0.75, marginTop: 24 }}>
          Staff access only
        </div>
      </div>
    ),
    size,
  )
}
