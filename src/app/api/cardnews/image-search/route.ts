// GET /api/cardnews/image-search?q=...&category=...&slide=N
// Unsplash → Pexels → Pixabay → Gemini Imagen fallback chain.
// 프론트는 슬라이드당 1회 호출해 자동 로드. Pinterest 플로우 삭제.
import { NextRequest, NextResponse } from 'next/server'
import { fetchCardnewsImage } from '@/lib/cardnews-image'
import type { CategoryKey } from '@/lib/cardnews-prompt'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const category = (url.searchParams.get('category') || '') as CategoryKey
  const slideIdx = parseInt(url.searchParams.get('slide') || '0', 10) || 0

  const result = await fetchCardnewsImage({
    koKeyword: q,
    category,
    slideIdx,
  })

  if (result.ok) {
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    })
  }
  return NextResponse.json(result, { status: 200 })
}
