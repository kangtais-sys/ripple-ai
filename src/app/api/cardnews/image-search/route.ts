// GET /api/cardnews/image-search?q=keyword&mode=pinterest|oliveyoung|gemini
// 우선순위: Pinterest(프론트에서 새탭 검색) → Gemini Imagen(서버 생성) 폴백
//
// Pinterest 는 공식 API 가 실제 인플루언서 무드 검색에 부적합 + 제약이 많아서
// 프론트에서 window.open 으로 검색 URL 을 여는 방식이 기본. 이 엔드포인트는
// Gemini Imagen 자동 생성 fallback 경로만 담당.
//
// GEMINI_API_KEY 가 없으면 { ok:false } 반환 → 프론트는 Pinterest 수동 플로우 유지
import { NextRequest, NextResponse } from 'next/server'
import { buildGeminiImagenPrompt } from '@/lib/cardnews-prompt'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const mode = (url.searchParams.get('mode') || 'gemini').toLowerCase()
  if (!q) return NextResponse.json({ ok: false, error: 'q_required' }, { status: 400 })

  // Pinterest·올리브영 은 URL 생성만 (프론트에서 새탭 열도록)
  if (mode === 'pinterest') {
    return NextResponse.json({
      ok: true,
      mode: 'pinterest',
      url: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`,
    })
  }
  if (mode === 'oliveyoung') {
    return NextResponse.json({
      ok: true,
      mode: 'oliveyoung',
      url: `https://global.oliveyoung.com/search?query=${encodeURIComponent(q)}`,
    })
  }

  // Gemini Imagen 생성 경로
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  if (!key) {
    return NextResponse.json({
      ok: false,
      error: 'gemini_key_missing',
      hint: 'GEMINI_API_KEY 환경변수가 설정되어 있지 않아 AI 이미지 생성 불가. 핀터레스트 수동 업로드를 사용해요.',
    })
  }

  const prompt = buildGeminiImagenPrompt(q)
  try {
    // Imagen 3 (generate-image) · v1beta
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: '1:1' },
        }),
      }
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return NextResponse.json({ ok: false, error: 'gemini_api_error', detail: detail.slice(0, 500) })
    }
    const data = await res.json() as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> }
    const p = data.predictions?.[0]
    if (!p?.bytesBase64Encoded) {
      return NextResponse.json({ ok: false, error: 'gemini_empty_response' })
    }
    const dataUrl = `data:${p.mimeType || 'image/png'};base64,${p.bytesBase64Encoded}`
    return NextResponse.json({ ok: true, mode: 'gemini', dataUrl, prompt })
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'gemini_exception', detail: String(e).slice(0, 300) })
  }
}
