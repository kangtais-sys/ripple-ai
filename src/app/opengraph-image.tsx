import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Ssobi. — 소셜 비서'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'radial-gradient(circle at 50% 20%, #0F2A22 0%, #0A0D12 100%)',
          padding: '72px',
          fontFamily: 'serif',
          position: 'relative',
        }}
      >
        {/* 민트 글로우 (우상단) */}
        <div style={{
          position: 'absolute',
          top: -200, right: -200,
          width: 600, height: 600,
          background: 'radial-gradient(circle, rgba(0,200,150,0.35), transparent 70%)',
          display: 'flex',
        }}/>

        {/* eyebrow */}
        <div style={{
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: 6,
          color: '#00C896',
          fontFamily: 'monospace',
          display: 'flex',
        }}>— SOCIAL · SECRETARY</div>

        {/* wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: -40, marginBottom: 'auto' }}>
          <div style={{
            fontSize: 240,
            fontStyle: 'italic',
            fontWeight: 300,
            letterSpacing: -8,
            color: '#FFFFFF',
            lineHeight: 1,
            display: 'flex',
          }}>Ssobi</div>
          <div style={{
            width: 30, height: 30, borderRadius: 15,
            background: '#00C896',
            marginLeft: 16, marginTop: 100,
            display: 'flex',
          }}/>
        </div>

        {/* tagline */}
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 16 }}>
          <div style={{
            fontSize: 46,
            fontWeight: 900,
            letterSpacing: -2,
            color: '#FFFFFF',
            fontFamily: 'sans-serif',
            display: 'flex',
          }}>키우고, 만들고.</div>
          <div style={{
            fontSize: 34,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.7)',
            fontFamily: 'sans-serif',
            marginTop: 10,
            display: 'flex',
          }}>
            이젠 나 대신&nbsp;
            <span style={{ color: '#00C896', fontStyle: 'italic', fontFamily: 'serif', display: 'flex' }}>Ssobi</span>
            가.
          </div>
        </div>

        {/* URL badge */}
        <div style={{
          position: 'absolute',
          bottom: 72, right: 72,
          padding: '10px 20px',
          borderRadius: 100,
          background: '#1A1F27',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.75)',
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: 1,
          fontFamily: 'monospace',
          display: 'flex',
        }}>ssobi.ai</div>
      </div>
    ),
    size
  )
}
