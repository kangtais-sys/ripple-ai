// GET /api/cardnews/:id/image  (public, no auth)
// Instagram Graph API 가 fetch 하는 이미지 엔드포인트
//   · Meta 는 JPEG 포맷 권장 (PNG 는 종종 OAuthException code 9004 발생)
//   · 긴 max-age 헤더 + Access-Control-Allow-Origin * 로 크롤러 친화적
//   · ImageResponse(Satori) 로 PNG 생성 → sharp 로 JPEG 변환
// 내부 동작: card_news_jobs 의 prompt_hook 등을 1080x1080 카드로 렌더

import { ImageResponse } from 'next/og'
import { createClient as createAdmin } from '@supabase/supabase-js'
import sharp from 'sharp'

export const runtime = 'nodejs'

type Params = { id: string }

export async function GET(req: Request, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params
  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data: job } = await admin
    .from('card_news_jobs')
    .select('prompt_hook, prompt_body, topic, template')
    .eq('id', id)
    .maybeSingle()

  const hook = (job?.prompt_hook as string) || (job?.topic as string) || 'Ssobi Cardnews'
  const tpl = (job?.template as string) || 'clean'
  const palette: Record<string, { bg: string; bgImage?: string; fg: string; accent: string }> = {
    clean:     { bg: '#FFFFFF', fg: '#1A1F27', accent: '#00C896' },
    bold:      { bg: '#1A1F27', fg: '#FFFFFF', accent: '#00C896' },
    mint:      { bg: '#00C896', fg: '#FFFFFF', accent: '#FFFFFF' },
    mag:       { bg: '#FAF7F2', fg: '#1A1F27', accent: '#00C896' },
    mono:      { bg: '#0F1319', fg: '#FFFFFF', accent: '#00C896' },
    editorial: { bg: '#FFF9F0', fg: '#2A1E12', accent: '#00A87E' },
    pastel:    { bg: '#FCE7F3', bgImage: 'linear-gradient(135deg,#FCE7F3,#E9D5FF)', fg: '#1A1F27', accent: '#8B5CF6' },
    pop:       { bg: '#FFD233', fg: '#1A1F27', accent: '#FF4D4D' },
  }
  const p = palette[tpl] || palette.clean

  const pngResponse = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 80,
          background: p.bg,
          backgroundImage: p.bgImage,
          color: p.fg,
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: 2,
            marginBottom: 32,
            color: p.accent,
            textTransform: 'uppercase',
          }}
        >
          Ssobi
        </div>
        <div
          style={{
            fontSize: hook.length > 30 ? 56 : 76,
            fontWeight: 900,
            lineHeight: 1.25,
            textAlign: 'center',
            letterSpacing: -1,
          }}
        >
          {hook}
        </div>
        <div
          style={{
            marginTop: 48,
            width: 80,
            height: 4,
            background: p.accent,
            borderRadius: 4,
          }}
        />
      </div>
    ),
    { width: 1080, height: 1080 }
  )

  const pngBuffer = Buffer.from(await pngResponse.arrayBuffer())
  const jpegBuffer = await sharp(pngBuffer).jpeg({ quality: 90, mozjpeg: true }).toBuffer()

  return new Response(jpegBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(jpegBuffer.length),
      // Meta 크롤러가 재시도 시 CDN 캐시로 빠른 응답
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, immutable',
      'Access-Control-Allow-Origin': '*',
      // Meta facebookexternalhit 등 크롤러 차단 없음을 명시
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
