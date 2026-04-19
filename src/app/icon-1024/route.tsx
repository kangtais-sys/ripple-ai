// 1024×1024 Ssobi 앱 아이콘 (Meta 앱 심사·앱스토어·고해상도 용)
// URL: https://ssobi.ai/icon-1024

import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
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
          position: 'relative',
        }}
      >
        {/* 민트 글로우 */}
        <div style={{
          position: 'absolute',
          top: -200, right: -200,
          width: 900, height: 900,
          background: 'radial-gradient(circle, rgba(0,200,150,0.25), transparent 70%)',
          display: 'flex',
        }}/>

        {/* S + 마침표 */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 30,
          position: 'relative',
        }}>
          <div style={{
            fontSize: 780,
            fontStyle: 'italic',
            fontWeight: 300,
            color: '#FFFFFF',
            fontFamily: 'serif',
            letterSpacing: -30,
            lineHeight: 0.85,
            display: 'flex',
            marginBottom: -30,
          }}>
            S
          </div>
          <div style={{
            width: 130, height: 130, borderRadius: 65,
            background: '#00C896',
            marginBottom: 60,
            display: 'flex',
          }}/>
        </div>
      </div>
    ),
    { width: 1024, height: 1024 }
  )
}
