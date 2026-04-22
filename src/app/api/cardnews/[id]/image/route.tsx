// GET /api/cardnews/:id/image?slide=N  (public, no auth)
// Instagram Graph API 가 fetch 하는 이미지 엔드포인트
// 구현: Satori(ImageResponse)로 PNG 렌더 → sharp 로 JPEG 변환
//   · Korean 지원: NotoSansKR WOFF 명시 로드
//   · Serif mood(editorial/noir): Fraunces italic
//   · Meta 는 JPEG 포맷 권장

import { ImageResponse } from 'next/og'
import { createClient as createAdmin } from '@supabase/supabase-js'
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'

// 폰트 버퍼 메모리 캐시 (Lambda warm 유지 시 재사용)
let CACHED_FONTS: {
  notoRegular?: ArrayBuffer
  notoBold?: ArrayBuffer
  frauncesItalic?: ArrayBuffer
} = {}

async function loadFonts() {
  if (CACHED_FONTS.notoRegular && CACHED_FONTS.notoBold) return CACHED_FONTS

  const fontsDir = path.join(process.cwd(), 'node_modules/@fontsource')
  const [notoR, notoB, fraI] = await Promise.all([
    readFile(path.join(fontsDir, 'noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff')),
    readFile(path.join(fontsDir, 'noto-sans-kr/files/noto-sans-kr-korean-900-normal.woff')),
    readFile(path.join(fontsDir, 'fraunces/files/fraunces-latin-400-italic.woff')).catch(() => null),
  ])

  CACHED_FONTS = {
    notoRegular: notoR.buffer.slice(notoR.byteOffset, notoR.byteOffset + notoR.byteLength) as ArrayBuffer,
    notoBold: notoB.buffer.slice(notoB.byteOffset, notoB.byteOffset + notoB.byteLength) as ArrayBuffer,
    frauncesItalic: fraI
      ? fraI.buffer.slice(fraI.byteOffset, fraI.byteOffset + fraI.byteLength) as ArrayBuffer
      : undefined,
  }
  return CACHED_FONTS
}

type Params = { id: string }
type Slide = { title?: string; text?: string }

type TplMeta = {
  bg: string                      // CSS background (linear-gradient or solid)
  fg: string
  accent: string
  muted: string
  fontFamily: string              // 'Noto' or 'Fraunces'
  weight: number
  italic?: boolean
}

const TPL: Record<string, TplMeta> = {
  clean:     { bg: '#FFFFFF',                                                     fg: '#1A1F27', accent: '#00C896', muted: '#6B7280', fontFamily: 'Noto',     weight: 800 },
  bold:      { bg: 'linear-gradient(160deg,#1A1F27,#374151)',                     fg: '#FFFFFF', accent: '#FFD233', muted: '#9CA3AF', fontFamily: 'Noto',     weight: 900 },
  mag:       { bg: 'linear-gradient(160deg,#FFF1F3,#FFE8EC)',                     fg: '#1A1F27', accent: '#E11D48', muted: '#8B7355', fontFamily: 'Fraunces', weight: 800, italic: true },
  editorial: { bg: '#FAF8F4',                                                     fg: '#2A1E12', accent: '#00A87E', muted: '#7A6654', fontFamily: 'Fraunces', weight: 400, italic: true },
  mono:      { bg: '#0F1319',                                                     fg: '#FFFFFF', accent: '#00C896', muted: '#A0A0A0', fontFamily: 'Noto',     weight: 500 },
  pastel:    { bg: 'linear-gradient(160deg,#FDF2F8,#E0E7FF)',                     fg: '#1A1F27', accent: '#8B5CF6', muted: '#6B21A8', fontFamily: 'Noto',     weight: 700 },
  noir:      { bg: 'linear-gradient(135deg,#0A0A0A 0%,#1F1F1F 50%,#0A0A0A 100%)', fg: '#FFFFFF', accent: '#D4A574', muted: '#6B5B47', fontFamily: 'Fraunces', weight: 400, italic: true },
  luxury:    { bg: 'linear-gradient(135deg,#0F0F0F 0%,#3A2A14 50%,#0F0F0F 100%)', fg: '#F5E7C8', accent: '#D4A574', muted: '#8B7355', fontFamily: 'Noto',     weight: 900 },
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
    .select('prompt_hook, prompt_body, topic, template, size')
    .eq('id', id)
    .maybeSingle()

  const hook = ((job?.prompt_hook as string) || (job?.topic as string) || 'Ssobi').slice(0, 80)
  const tpl = (job?.template as string) || 'clean'
  const body: Slide[] = Array.isArray(job?.prompt_body) ? (job!.prompt_body as Slide[]) : []
  const totalSlides = Math.max(1, body.length > 0 ? body.length + 1 : 1)
  const p = TPL[tpl] || TPL.clean

  // 사이즈: sq(1:1 1080) / pt(4:5 1080x1350) / st(9:16 1080x1920 피드 X)
  //   IG 피드 허용 비율: 1:1, 1.91:1, 4:5
  const sizeKey = (url.searchParams.get('size') as string) || (job?.size as string) || 'sq'
  const DIM: Record<string, { w: number; h: number }> = {
    sq: { w: 1080, h: 1080 },
    pt: { w: 1080, h: 1350 },
    st: { w: 1080, h: 1920 },
  }
  const dim = DIM[sizeKey] || DIM.sq

  const fonts = await loadFonts()
  const imageFonts: Array<{ name: string; data: ArrayBuffer; weight: 400 | 700 | 900; style: 'normal' | 'italic' }> = []
  if (fonts.notoRegular) imageFonts.push({ name: 'Noto', data: fonts.notoRegular, weight: 400, style: 'normal' })
  if (fonts.notoBold)    imageFonts.push({ name: 'Noto', data: fonts.notoBold,    weight: 900, style: 'normal' })
  if (fonts.frauncesItalic) imageFonts.push({ name: 'Fraunces', data: fonts.frauncesItalic, weight: 400, style: 'italic' })

  const pageLabel = `${Math.min(slideIdx + 1, totalSlides)} / ${totalSlides}`
  const slideContent = slideIdx === 0
    ? renderCover(hook, p, pageLabel)
    : renderBody(body[Math.min(slideIdx - 1, body.length - 1)] || { title: '', text: '' }, slideIdx, p, pageLabel)

  const imgRes = new ImageResponse(slideContent, {
    width: dim.w,
    height: dim.h,
    fonts: imageFonts,
  })

  // PNG → JPEG 변환 (Meta 는 JPEG 권장)
  const pngBuffer = Buffer.from(await imgRes.arrayBuffer())
  const jpegBuffer = await sharp(pngBuffer).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
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

// ─────────────────────────────────────────────────────
// 슬라이드 레이아웃 (Satori JSX)
// ─────────────────────────────────────────────────────
function renderCover(hook: string, p: TplMeta, pageLabel: string) {
  const fontSize = hook.length > 25 ? 80 : 100
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '80px 80px 60px',
        background: p.bg,
        color: p.fg,
        fontFamily: p.fontFamily,
      }}
    >
      <div style={{
        fontSize: 28,
        fontWeight: 800,
        letterSpacing: 6,
        color: p.accent,
        marginBottom: 80,
      }}>
        SSOBI
      </div>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        justifyContent: 'center',
      }}>
        <div style={{
          fontSize,
          fontWeight: p.weight,
          lineHeight: 1.2,
          letterSpacing: -2,
          fontStyle: p.italic ? 'italic' : 'normal',
          whiteSpace: 'pre-wrap',
        }}>
          {hook}
        </div>
        <div style={{
          marginTop: 40,
          width: 120,
          height: 6,
          background: p.accent,
          borderRadius: 3,
        }} />
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        color: p.muted,
        fontSize: 22,
        fontWeight: 600,
        fontStyle: p.italic ? 'italic' : 'normal',
      }}>
        <div>저장해두면 두고두고 써먹어요</div>
        <div style={{ fontWeight: 700, fontStyle: 'normal', fontFamily: 'Noto' }}>{pageLabel}</div>
      </div>
    </div>
  )
}

function renderBody(slide: Slide, idx: number, p: TplMeta, pageLabel: string) {
  const title = (slide.title || '').slice(0, 60)
  const text = (slide.text || '').slice(0, 400)
  const titleFS = title.length > 20 ? 60 : 72
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '80px 80px 60px',
        background: p.bg,
        color: p.fg,
        fontFamily: p.fontFamily,
      }}
    >
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        marginBottom: 40,
      }}>
        <div style={{
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: 6,
          color: p.accent,
          marginBottom: 12,
          fontFamily: 'Noto',
        }}>
          SSOBI
        </div>
        <div style={{
          fontSize: 28,
          fontWeight: 800,
          color: p.accent,
          fontFamily: 'Noto',
        }}>
          {String(idx).padStart(2, '0')}
        </div>
      </div>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
      }}>
        <div style={{
          fontSize: titleFS,
          fontWeight: p.weight,
          lineHeight: 1.22,
          letterSpacing: -1,
          fontStyle: p.italic ? 'italic' : 'normal',
          whiteSpace: 'pre-wrap',
          marginBottom: 24,
        }}>
          {title}
        </div>
        <div style={{
          marginBottom: 40,
          width: 80,
          height: 4,
          background: p.accent,
          borderRadius: 2,
        }} />
        <div style={{
          fontSize: 32,
          fontWeight: 500,
          lineHeight: 1.55,
          fontStyle: p.italic ? 'italic' : 'normal',
          opacity: 0.92,
          whiteSpace: 'pre-wrap',
        }}>
          {text}
        </div>
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        color: p.muted,
        fontSize: 22,
        fontWeight: 700,
        fontFamily: 'Noto',
      }}>
        {pageLabel}
      </div>
    </div>
  )
}
