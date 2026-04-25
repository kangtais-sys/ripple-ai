// GET /api/cardnews/video-search?q=keyword&category=...&slide=N
//   카드뉴스 슬라이드 stock 영상 fetch
//   Pexels Videos → Pixabay Videos
//   응답: { ok, url, thumbnail, duration, source, sourceLabel, photographer, attributionUrl }
import { NextRequest, NextResponse } from 'next/server'
import { fetchCardnewsVideo } from '@/lib/cardnews-video'
import type { CategoryKey } from '@/lib/cardnews-prompt'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const category = (url.searchParams.get('category') || '') as CategoryKey
  const slideIdx = parseInt(url.searchParams.get('slide') || '0', 10) || 0

  const result = await fetchCardnewsVideo({
    koKeyword: q,
    category,
    slideIdx,
  })

  return NextResponse.json(result, {
    headers: result.ok ? { 'Cache-Control': 'public, max-age=3600' } : {},
  })
}
