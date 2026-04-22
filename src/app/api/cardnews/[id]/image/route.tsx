// GET /api/cardnews/:id/image?slide=N  (public, no auth)
// Instagram Graph API 가 fetch 하는 이미지 엔드포인트
//   · Meta 는 JPEG 권장 (PNG 는 9004 에러)
//   · ?slide=0 → 표지 (hook), ?slide=N → body[N-1], 기본값 0
// 구현: SVG 렌더 → sharp 로 JPEG 변환

import { createClient as createAdmin } from '@supabase/supabase-js'
import sharp from 'sharp'

export const runtime = 'nodejs'

type Params = { id: string }
type Slide = { title?: string; text?: string }

function escapeXml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  if (!text) return []
  const normalized = text.replace(/\s+/g, ' ').trim()
  const words = normalized.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w
    if (next.length > maxCharsPerLine) {
      if (cur) lines.push(cur)
      cur = w
    } else {
      cur = next
    }
  }
  if (cur) lines.push(cur)
  return lines.slice(0, maxLines)
}

export async function GET(req: Request, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params
  const url = new URL(req.url)
  const slideIdx = Math.max(0, parseInt(url.searchParams.get('slide') || '0', 10) || 0)

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data: job } = await admin
    .from('card_news_jobs')
    .select('prompt_hook, prompt_body, topic, template, slide_count')
    .eq('id', id)
    .maybeSingle()

  const hook = ((job?.prompt_hook as string) || (job?.topic as string) || 'Ssobi').slice(0, 80)
  const tpl = (job?.template as string) || 'clean'
  const body: Slide[] = Array.isArray(job?.prompt_body) ? (job!.prompt_body as Slide[]) : []
  const totalSlides = Math.max(1, body.length > 0 ? body.length + 1 : 1)  // 표지 + 본문

  // 템플릿 메타: bg/fg/accent + font + italic
  const TPL: Record<string, {
    bg: string
    bgStops?: Array<{ offset: string; color: string }>  // gradient stops (노이어·럭셔리)
    fg: string
    accent: string
    muted: string
    font: string        // font-family (SVG에서 쓰는 generic name)
    weight: number
    italic?: boolean
  }> = {
    clean:     { bg: '#FFFFFF', fg: '#1A1F27', accent: '#00C896', muted: '#6B7280', font: 'sans-serif', weight: 800 },
    bold:      { bg: '#1A1F27', fg: '#FFFFFF', accent: '#FFD233', muted: '#9CA3AF', font: 'sans-serif', weight: 900 },
    mag:       { bg: '#FAF7F2', fg: '#1A1F27', accent: '#E11D48', muted: '#8B7355', font: 'serif',       weight: 800 },
    editorial: { bg: '#FFF9F0', fg: '#2A1E12', accent: '#00A87E', muted: '#7A6654', font: 'serif',       weight: 400, italic: true },
    mono:      { bg: '#0F1319', fg: '#FFFFFF', accent: '#00C896', muted: '#A0A0A0', font: 'monospace',  weight: 500 },
    pastel:    { bg: '#FCE7F3', fg: '#1A1F27', accent: '#8B5CF6', muted: '#6B21A8', font: 'sans-serif', weight: 600 },
    noir: {
      bg: '#0A0A0A',
      bgStops: [{ offset: '0%', color: '#0A0A0A' }, { offset: '50%', color: '#1F1F1F' }, { offset: '100%', color: '#0A0A0A' }],
      fg: '#FFFFFF', accent: '#D4A574', muted: '#6B5B47', font: 'serif', weight: 400, italic: true,
    },
    luxury: {
      bg: '#0F0F0F',
      bgStops: [{ offset: '0%', color: '#0F0F0F' }, { offset: '50%', color: '#3A2A14' }, { offset: '100%', color: '#0F0F0F' }],
      fg: '#F5E7C8', accent: '#D4A574', muted: '#8B7355', font: 'sans-serif', weight: 900,
    },
  }
  const p = TPL[tpl] || TPL.clean
  const italicAttr = p.italic ? 'font-style="italic"' : ''
  const gradient = p.bgStops
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${p.bgStops.map(s => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join('')}</linearGradient></defs>`
    : ''
  const bgFill = p.bgStops ? 'url(#g)' : p.bg

  // 슬라이드 결정
  //   slide=0 → 표지 (hook)
  //   slide=1..body.length → body[slide-1]
  let svg = ''
  const pageLabel = `${Math.min(slideIdx + 1, totalSlides)} / ${totalSlides}`

  if (slideIdx === 0) {
    // 표지 슬라이드
    const lines = wrapText(hook, 12, 4)
    const fontSize = hook.length > 25 ? 76 : 92
    const lh = fontSize * 1.15
    const startY = 540 - ((lines.length - 1) * lh) / 2
    svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  ${gradient}
  <rect width="1080" height="1080" fill="${bgFill}"/>
  <text x="80" y="120" fill="${p.accent}" font-family="sans-serif" font-size="28" font-weight="800" letter-spacing="6">SSOBI</text>
  ${lines.map((line, i) =>
    `<text x="80" y="${startY + i * lh}" fill="${p.fg}" font-family="${p.font}" font-size="${fontSize}" font-weight="${p.weight}" ${italicAttr} letter-spacing="-2">${escapeXml(line)}</text>`
  ).join('\n  ')}
  <rect x="80" y="${startY + lines.length * lh + 30}" width="120" height="6" fill="${p.accent}" rx="3"/>
  <text x="80" y="980" fill="${p.muted}" font-family="${p.font}" font-size="22" font-weight="600" ${italicAttr}>저장해두면 두고두고 써먹어요</text>
  <text x="1000" y="980" fill="${p.muted}" font-family="sans-serif" font-size="22" font-weight="700" text-anchor="end">${pageLabel}</text>
</svg>`
  } else {
    // 본문 슬라이드 (body[slideIdx - 1])
    const slide = body[Math.min(slideIdx - 1, body.length - 1)] || { title: '', text: '' }
    const title = (slide.title || '').slice(0, 60)
    const text = (slide.text || '').slice(0, 400)
    const titleLines = wrapText(title, 14, 2)
    const bodyLines = wrapText(text, 20, 8)
    const titleFS = title.length > 20 ? 56 : 68
    const titleLH = titleFS * 1.2
    const bodyFS = 32
    const bodyLH = bodyFS * 1.45

    svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  ${gradient}
  <rect width="1080" height="1080" fill="${bgFill}"/>
  <text x="80" y="120" fill="${p.accent}" font-family="sans-serif" font-size="28" font-weight="800" letter-spacing="6">SSOBI</text>
  <text x="80" y="180" fill="${p.accent}" font-family="sans-serif" font-size="24" font-weight="800">${String(slideIdx).padStart(2, '0')}</text>
  ${titleLines.map((line, i) =>
    `<text x="80" y="${260 + i * titleLH}" fill="${p.fg}" font-family="${p.font}" font-size="${titleFS}" font-weight="${p.weight}" ${italicAttr} letter-spacing="-1">${escapeXml(line)}</text>`
  ).join('\n  ')}
  <rect x="80" y="${260 + titleLines.length * titleLH + 30}" width="80" height="4" fill="${p.accent}" rx="2"/>
  ${bodyLines.map((line, i) =>
    `<text x="80" y="${260 + titleLines.length * titleLH + 90 + i * bodyLH}" fill="${p.fg}" font-family="${p.font}" font-size="${bodyFS}" font-weight="500" ${italicAttr} opacity="0.92">${escapeXml(line)}</text>`
  ).join('\n  ')}
  <text x="1000" y="980" fill="${p.muted}" font-family="sans-serif" font-size="22" font-weight="700" text-anchor="end">${pageLabel}</text>
</svg>`
  }

  const jpegBuffer = await sharp(Buffer.from(svg))
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
  const out = new Uint8Array(jpegBuffer)

  return new Response(out, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(out.length),
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, immutable',
      'Access-Control-Allow-Origin': '*',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
