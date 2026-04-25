// 카드뉴스용 stock 영상 fetch
// 우선순위: Pexels Videos → Pixabay Videos
// 이미 등록된 PEXELS_API_KEY · PIXABAY_API_KEY 그대로 사용 (사진 + 영상 통합)
//
// 환경변수:
//   PEXELS_API_KEY  — Pexels 계정 하나로 photos·videos 둘 다 사용
//   PIXABAY_API_KEY — Pixabay 동일 (videos 엔드포인트는 별도)

import type { CategoryKey } from './cardnews-prompt'

export type VideoResult =
  | {
      ok: true
      url: string                    // mp4 직링크 (IG 캐러셀 child 가 fetch)
      thumbnail?: string             // 미리보기 이미지
      duration?: number              // 초 단위
      source: 'pexels' | 'pixabay'
      sourceLabel: 'Pexels' | 'Pixabay'
      photographer?: string
      attributionUrl?: string
    }
  | { ok: false; error: string; detail?: string }

// 카테고리별 영문 영상 키워드 (이미지보다 더 넓게 — 영상은 stock 풀이 좁음)
const CATEGORY_VIDEO_EN: Record<CategoryKey, string[]> = {
  beauty_treatment: ['skin care close up', 'face beauty natural', 'cosmetic application'],
  beauty_product: ['skincare product flatlay', 'cosmetic bottle macro', 'beauty product showcase'],
  beauty_ingredient: ['serum drops macro', 'cosmetic texture pour', 'liquid beauty texture'],
  beauty_trouble: ['skin care routine', 'face washing close up', 'natural skin'],
  food: ['food cooking close up', 'plating food', 'korean food'],
  cafe: ['coffee pouring', 'cafe latte art', 'barista coffee'],
  travel_domestic: ['korea travel scenery', 'seoul timelapse', 'jeju nature'],
  travel_abroad: ['travel landscape', 'city aerial', 'nature scenic'],
  fashion: ['fashion outfit', 'clothing closet', 'style flatlay'],
  interior: ['minimal interior', 'home decor', 'modern apartment'],
  fitness: ['workout exercise', 'pilates yoga', 'running fitness'],
  money_tip: ['money saving lifestyle', 'minimal desk', 'productivity'],
  price_compare: ['shopping comparison', 'product unboxing', 'haul'],
  trend: ['young people lifestyle', 'urban youth', 'trendy aesthetic'],
  review: ['product review', 'unboxing', 'product close up'],
  life_tip: ['daily lifestyle', 'morning routine', 'home life'],
  book: ['reading book', 'library aesthetic', 'book pages'],
  etc: ['daily lifestyle', 'aesthetic minimal', 'cozy moment'],
}

function pickKeyword(args: { koKeyword?: string; category?: CategoryKey; slideIdx?: number }): string {
  const cat = args.category || 'etc'
  const pool = CATEGORY_VIDEO_EN[cat] || CATEGORY_VIDEO_EN.etc
  const idx = args.slideIdx ?? 0
  return pool[idx % pool.length]
}

// ─────────────────────────────────────────────
// Pexels Videos — 무료, sd/hd/4k 다양
// ─────────────────────────────────────────────
async function fetchPexelsVideo(q: string): Promise<VideoResult> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return { ok: false, error: 'pexels_no_key' }
  try {
    // 필터 없이 검색 (orientation=portrait 가 너무 strict 해서 결과 0)
    const res = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=10`,
      { headers: { Authorization: key } }
    )
    if (!res.ok) return { ok: false, error: 'pexels_http', detail: `${res.status}` }
    const data = await res.json() as {
      videos?: Array<{
        id?: number
        url?: string
        duration?: number
        image?: string
        user?: { name?: string; url?: string }
        video_files?: Array<{ link?: string; quality?: string; file_type?: string; width?: number; height?: number }>
      }>
    }
    const list = data.videos || []
    if (!list.length) return { ok: false, error: 'pexels_empty' }
    // 광고성 첫 항목 제외 + 너무 긴 영상 제외 (60초 이내)
    const pool = list.filter(v => (v.duration || 999) <= 60).slice(2, 8)
    const pick = (pool.length ? pool : list)[Math.floor(Math.random() * Math.max(1, (pool.length ? pool.length : list.length)))]
    if (!pick) return { ok: false, error: 'pexels_no_pick' }
    // 가장 작은 mp4 파일 선택 (IG 가 fetch 빠르게)
    const mp4 = (pick.video_files || []).filter(f => f.file_type === 'video/mp4')
    mp4.sort((a, b) => (a.width || 9999) - (b.width || 9999))
    // 너무 작으면 SD 이상 (480p+) 선택
    const file = mp4.find(f => (f.width || 0) >= 480) || mp4[0]
    if (!file?.link) return { ok: false, error: 'pexels_no_file' }
    return {
      ok: true,
      url: file.link,
      thumbnail: pick.image,
      duration: pick.duration,
      source: 'pexels',
      sourceLabel: 'Pexels',
      photographer: pick.user?.name,
      attributionUrl: pick.url,
    }
  } catch (e) {
    return { ok: false, error: 'pexels_exception', detail: String(e).slice(0, 200) }
  }
}

// ─────────────────────────────────────────────
// Pixabay Videos
// ─────────────────────────────────────────────
async function fetchPixabayVideo(q: string): Promise<VideoResult> {
  const key = process.env.PIXABAY_API_KEY
  if (!key) return { ok: false, error: 'pixabay_no_key' }
  try {
    const res = await fetch(
      `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(q)}&per_page=10&order=popular&safesearch=true`
    )
    if (!res.ok) return { ok: false, error: 'pixabay_http', detail: `${res.status}` }
    const data = await res.json() as {
      hits?: Array<{
        id?: number
        pageURL?: string
        duration?: number
        videos?: { tiny?: { url?: string }; small?: { url?: string }; medium?: { url?: string }; large?: { url?: string } }
        user?: string
        user_id?: number
        picture_id?: string
      }>
    }
    const hits = (data.hits || []).filter(h => (h.duration || 999) <= 60)
    if (!hits.length) return { ok: false, error: 'pixabay_empty' }
    const pool = hits.slice(2, 10)
    const pick = (pool.length ? pool : hits)[Math.floor(Math.random() * Math.max(1, (pool.length ? pool.length : hits.length)))]
    const url = pick.videos?.medium?.url || pick.videos?.small?.url || pick.videos?.tiny?.url
    if (!url) return { ok: false, error: 'pixabay_no_file' }
    return {
      ok: true,
      url,
      thumbnail: pick.picture_id ? `https://i.vimeocdn.com/video/${pick.picture_id}_640x360.jpg` : undefined,
      duration: pick.duration,
      source: 'pixabay',
      sourceLabel: 'Pixabay',
      photographer: pick.user,
      attributionUrl: pick.pageURL,
    }
  } catch (e) {
    return { ok: false, error: 'pixabay_exception', detail: String(e).slice(0, 200) }
  }
}

// ─────────────────────────────────────────────
// 메인 체인 — Pexels → Pixabay
// ─────────────────────────────────────────────
export async function fetchCardnewsVideo(args: {
  koKeyword?: string
  category?: CategoryKey
  slideIdx?: number
}): Promise<VideoResult> {
  const q = pickKeyword(args)
  const errs: string[] = []
  for (const provider of [fetchPexelsVideo, fetchPixabayVideo]) {
    const r = await provider(q)
    if (r.ok) return r
    errs.push(r.error)
  }
  return { ok: false, error: 'all_failed', detail: errs.join(' | ') }
}
