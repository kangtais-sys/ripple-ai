import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1A1F27 0%, #0F1319 100%)',
          borderRadius: '40px',
          position: 'relative',
        }}
      >
        <div style={{
          fontSize: 120,
          fontStyle: 'italic',
          fontWeight: 400,
          color: '#FFFFFF',
          fontFamily: 'serif',
          letterSpacing: -4,
          display: 'flex',
          marginLeft: -10,
        }}>
          S
        </div>
        <div style={{
          position: 'absolute',
          width: 22, height: 22, borderRadius: 11,
          background: '#00C896',
          right: 46, bottom: 54,
          display: 'flex',
        }}/>
      </div>
    ),
    size
  )
}
