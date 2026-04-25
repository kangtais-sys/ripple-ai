// GET /api/cardnews/entity-image?type=book&name=원씽
//   실존 책·제품·브랜드·장소의 실제 이미지 fetch
//   순서: Google Books → Wikipedia → Open Library
//   공식 API · 공개 라이센스만 사용 (저작권 안전)
import { NextRequest, NextResponse } from 'next/server'
import { fetchEntityImage, type EntityType } from '@/lib/entity-image'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const type = (url.searchParams.get('type') || 'book') as EntityType
  const name = (url.searchParams.get('name') || '').trim()
  if (!name) return NextResponse.json({ ok: false, error: 'name_required' }, { status: 400 })
  const result = await fetchEntityImage({ type, name })
  return NextResponse.json(result, {
    headers: result.ok ? { 'Cache-Control': 'public, max-age=86400' } : {},
  })
}
