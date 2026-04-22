// GET /api/cardnews/:id/image  (public, no auth)
// Instagram Graph API 가 fetch 하는 이미지 엔드포인트
//   · Meta 는 JPEG 포맷 권장 (PNG 는 OAuthException 9004 발생)
//   · 긴 max-age + ACAO:* 로 크롤러 친화적
// 구현: SVG 렌더 → sharp 로 JPEG 변환 (Satori/ImageResponse 미사용)

import { createClient as createAdmin } from '@supabase/supabase-js'
import sharp from 'sharp'

export const runtime = 'nodejs'

type Params = { id: string }

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// 긴 텍스트를 줄바꿈 (대략적 — 한글·영문 혼합 고려)
function wrapText(text: string, maxCharsPerLine: number): string[] {
  if (!text) return ['Ssobi Cardnews']
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxCharsPerLine) {
      if (cur) lines.push(cur.trim())
      cur = w
    } else {
      cur = (cur + ' ' + w).trim()
    }
  }
  if (cur) lines.push(cur.trim())
  return lines.slice(0, 4)  // 최대 4줄
}

export async function GET(req: Request, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params
  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data: job } = await admin
    .from('card_news_jobs')
    .select('prompt_hook, topic, template')
    .eq('id', id)
    .maybeSingle()

  const rawHook = (job?.prompt_hook as string) || (job?.topic as string) || 'Ssobi Cardnews'
  const hook = rawHook.slice(0, 80)  // 너무 길면 컷
  const tpl = (job?.template as string) || 'clean'

  const palette: Record<string, { bg: string; fg: string; accent: string }> = {
    clean:     { bg: '#FFFFFF', fg: '#1A1F27', accent: '#00C896' },
    bold:      { bg: '#1A1F27', fg: '#FFFFFF', accent: '#00C896' },
    mint:      { bg: '#00C896', fg: '#FFFFFF', accent: '#FFFFFF' },
    mag:       { bg: '#FAF7F2', fg: '#1A1F27', accent: '#00C896' },
    mono:      { bg: '#0F1319', fg: '#FFFFFF', accent: '#00C896' },
    editorial: { bg: '#FFF9F0', fg: '#2A1E12', accent: '#00A87E' },
    pastel:    { bg: '#FCE7F3', fg: '#1A1F27', accent: '#8B5CF6' },
    pop:       { bg: '#FFD233', fg: '#1A1F27', accent: '#FF4D4D' },
  }
  const p = palette[tpl] || palette.clean

  const hookLines = wrapText(hook, 15)
  const fontSize = hook.length > 30 ? 60 : 80
  const lineHeight = fontSize * 1.2
  const startY = 540 - ((hookLines.length - 1) * lineHeight) / 2

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="${p.bg}"/>
  <text x="540" y="380" fill="${p.accent}" font-family="sans-serif" font-size="36" font-weight="700" letter-spacing="4" text-anchor="middle">SSOBI</text>
  ${hookLines.map((line, i) =>
    `<text x="540" y="${startY + i * lineHeight}" fill="${p.fg}" font-family="sans-serif" font-size="${fontSize}" font-weight="900" text-anchor="middle">${escapeXml(line)}</text>`
  ).join('\n  ')}
  <rect x="500" y="${startY + hookLines.length * lineHeight + 30}" width="80" height="4" fill="${p.accent}" rx="2"/>
</svg>`

  const jpegBuffer = await sharp(Buffer.from(svg))
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()

  const body = new Uint8Array(jpegBuffer)

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(body.length),
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, immutable',
      'Access-Control-Allow-Origin': '*',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
