// 카드뉴스 이미지 자동 fetch 체인
// 우선순위: Unsplash → Pexels → Pixabay → Gemini Imagen
// 키가 없는 provider 는 자동 스킵. 전부 실패하면 { ok:false }.
//
// 환경변수:
//   UNSPLASH_ACCESS_KEY  — https://unsplash.com/developers (무료, 50req/hour)
//   PEXELS_API_KEY        — https://www.pexels.com/api/ (무료, 200req/hour)
//   PIXABAY_API_KEY       — https://pixabay.com/api/docs/ (무료, 100req/min)
//   GEMINI_API_KEY        — https://aistudio.google.com/apikey (무료 티어)
//
// 카테고리별 영어 aesthetic 키워드로 자동 변환 (한국어 그대로 검색하면 결과 빈약)
// Pinterest 는 공개 API 없고 스크래핑은 TOS 위반 여지 → 제외

import type { CategoryKey } from './cardnews-prompt'

export type ImageResult =
  | { ok: true; url: string; source: 'unsplash' | 'pexels' | 'pixabay' | 'gemini'; attribution?: string }
  | { ok: false; error: string; detail?: string }

// ─────────────────────────────────────────────
// 카테고리별 영어 aesthetic 키워드 매핑
// 장 인덱스(0-based)별 뉘앙스를 살짝 다르게
// ─────────────────────────────────────────────
const CATEGORY_EN_KEYWORDS: Record<CategoryKey, string[]> = {
  beauty_treatment: [
    'skin glow close-up aesthetic',
    'korean skincare face aesthetic',
    'natural beauty face aesthetic photography',
  ],
  beauty_product: [
    'skincare flatlay aesthetic',
    'cosmetics product aesthetic',
    'beauty routine aesthetic photography',
  ],
  beauty_ingredient: [
    'serum texture close-up aesthetic',
    'skincare drops macro photography',
    'cosmetic texture aesthetic',
  ],
  beauty_trouble: [
    'skin texture aesthetic photography',
    'natural skin close-up minimal',
    'korean skincare aesthetic',
  ],
  food: [
    'korean food plating aesthetic',
    'food photography aesthetic minimal',
    'dessert close-up aesthetic',
  ],
  cafe: [
    'cafe aesthetic coffee',
    'latte art aesthetic film',
    'cafe interior aesthetic',
  ],
  travel_domestic: [
    'korea travel aesthetic film',
    'seoul aesthetic photography',
    'jeju aesthetic landscape',
  ],
  travel_abroad: [
    'travel aesthetic landscape film',
    'overseas trip aesthetic',
    'travel photography aesthetic',
  ],
  fashion: [
    'fashion ootd aesthetic',
    'korean street fashion film',
    'style flatlay aesthetic',
  ],
  interior: [
    'minimal home interior aesthetic',
    'scandinavian interior aesthetic',
    'room decor aesthetic',
  ],
  fitness: [
    'workout aesthetic photography',
    'pilates studio aesthetic',
    'yoga aesthetic minimal',
  ],
  money_tip: [
    'minimalist lifestyle aesthetic',
    'simple desk aesthetic',
    'minimal aesthetic photography',
  ],
  price_compare: [
    'product flatlay aesthetic',
    'cosmetics comparison aesthetic',
    'shopping flatlay aesthetic',
  ],
  trend: [
    'youth lifestyle aesthetic',
    'gen z aesthetic photography',
    'urban aesthetic film',
  ],
  review: [
    'product review aesthetic',
    'product close-up aesthetic',
    'flatlay product aesthetic',
  ],
  life_tip: [
    'everyday lifestyle aesthetic',
    'daily life aesthetic photography',
    'minimal lifestyle aesthetic',
  ],
  etc: [
    'daily aesthetic photography',
    'lifestyle aesthetic film',
    'minimal aesthetic',
  ],
}

// 한국어 검색어 → 영어 aesthetic 키워드로 변환
//   category 가 있으면 카테고리별 3개 중 slideIdx 로 고름 + 원본 주제 키워드 1개 보강
export function toEnKeyword(args: {
  koKeyword?: string
  category?: CategoryKey
  slideIdx?: number
}): string {
  const cat = args.category || 'etc'
  const pool = CATEGORY_EN_KEYWORDS[cat] || CATEGORY_EN_KEYWORDS.etc
  const base = pool[(args.slideIdx ?? 0) % pool.length]
  // 원본이 이미 영어면 그대로 쓸 수 있지만 aesthetic 키워드 보강
  const ko = (args.koKeyword || '').trim()
  const isLatin = ko.length > 0 && /^[\x00-\x7F\s]+$/.test(ko)
  if (isLatin && ko.length > 3) return `${ko} aesthetic`
  return base
}

// ─────────────────────────────────────────────
// 각 provider — 키 없으면 { ok:false } 즉시 반환
// ─────────────────────────────────────────────
async function fetchUnsplash(q: string): Promise<ImageResult> {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) return { ok: false, error: 'unsplash_no_key' }
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=10&orientation=squarish`,
      { headers: { Authorization: `Client-ID ${key}` } }
    )
    if (!res.ok) return { ok: false, error: 'unsplash_http', detail: `${res.status}` }
    const data = await res.json() as {
      results?: Array<{ urls?: { regular?: string; small?: string }; user?: { name?: string } }>
    }
    const results = data.results || []
    if (!results.length) return { ok: false, error: 'unsplash_empty' }
    // 상위 10개 중 3~9번째 랜덤 (상단 광고성 제외)
    const pool = results.slice(3, 10)
    const pick = (pool.length ? pool : results)[Math.floor(Math.random() * Math.max(1, (pool.length ? pool.length : results.length)))]
    const url = pick?.urls?.regular || pick?.urls?.small
    if (!url) return { ok: false, error: 'unsplash_no_url' }
    return { ok: true, url, source: 'unsplash', attribution: pick.user?.name }
  } catch (e) {
    return { ok: false, error: 'unsplash_exception', detail: String(e).slice(0, 200) }
  }
}

async function fetchPexels(q: string): Promise<ImageResult> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return { ok: false, error: 'pexels_no_key' }
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=10&orientation=square&size=medium`,
      { headers: { Authorization: key } }
    )
    if (!res.ok) return { ok: false, error: 'pexels_http', detail: `${res.status}` }
    const data = await res.json() as {
      photos?: Array<{ src?: { large?: string; large2x?: string; medium?: string }; photographer?: string }>
    }
    const photos = data.photos || []
    if (!photos.length) return { ok: false, error: 'pexels_empty' }
    const pool = photos.slice(3, 10)
    const pick = (pool.length ? pool : photos)[Math.floor(Math.random() * Math.max(1, (pool.length ? pool.length : photos.length)))]
    const url = pick?.src?.large2x || pick?.src?.large || pick?.src?.medium
    if (!url) return { ok: false, error: 'pexels_no_url' }
    return { ok: true, url, source: 'pexels', attribution: pick.photographer }
  } catch (e) {
    return { ok: false, error: 'pexels_exception', detail: String(e).slice(0, 200) }
  }
}

async function fetchPixabay(q: string): Promise<ImageResult> {
  const key = process.env.PIXABAY_API_KEY
  if (!key) return { ok: false, error: 'pixabay_no_key' }
  try {
    const res = await fetch(
      `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(q)}&image_type=photo&orientation=horizontal&per_page=20&safesearch=true&order=popular`
    )
    if (!res.ok) return { ok: false, error: 'pixabay_http', detail: `${res.status}` }
    const data = await res.json() as {
      hits?: Array<{ largeImageURL?: string; webformatURL?: string; user?: string }>
    }
    const hits = data.hits || []
    if (!hits.length) return { ok: false, error: 'pixabay_empty' }
    const pool = hits.slice(3, 15)
    const pick = (pool.length ? pool : hits)[Math.floor(Math.random() * Math.max(1, (pool.length ? pool.length : hits.length)))]
    const url = pick?.largeImageURL || pick?.webformatURL
    if (!url) return { ok: false, error: 'pixabay_no_url' }
    return { ok: true, url, source: 'pixabay', attribution: pick.user }
  } catch (e) {
    return { ok: false, error: 'pixabay_exception', detail: String(e).slice(0, 200) }
  }
}

async function fetchGeminiImagen(prompt: string): Promise<ImageResult> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  if (!key) return { ok: false, error: 'gemini_no_key' }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: `photorealistic ${prompt}, Korean style, natural lighting, no text, no illustration, no typography` }],
          parameters: { sampleCount: 1, aspectRatio: '1:1' },
        }),
      }
    )
    if (!res.ok) return { ok: false, error: 'gemini_http', detail: `${res.status}` }
    const data = await res.json() as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> }
    const p = data.predictions?.[0]
    if (!p?.bytesBase64Encoded) return { ok: false, error: 'gemini_empty' }
    return { ok: true, url: `data:${p.mimeType || 'image/png'};base64,${p.bytesBase64Encoded}`, source: 'gemini' }
  } catch (e) {
    return { ok: false, error: 'gemini_exception', detail: String(e).slice(0, 200) }
  }
}

// 금지 키워드 제거 (글자 이미지 유발 단어)
const BAD = ['tips', 'tutorial', 'guide', 'how to', 'recipe', 'infographic', 'quote', 'checklist', 'steps']
function cleanQuery(q: string): string {
  let clean = q
  for (const bad of BAD) clean = clean.replace(new RegExp(bad, 'gi'), '').trim()
  return clean.replace(/\s+/g, ' ').trim()
}

// ─────────────────────────────────────────────
// 메인 체인 — 키 있는 첫 번째 provider 가 성공하면 반환
// ─────────────────────────────────────────────
export async function fetchCardnewsImage(args: {
  koKeyword?: string
  category?: CategoryKey
  slideIdx?: number
}): Promise<ImageResult> {
  const enQuery = cleanQuery(toEnKeyword(args))
  const errs: string[] = []
  for (const provider of [fetchUnsplash, fetchPexels, fetchPixabay, fetchGeminiImagen]) {
    const r = await provider(enQuery)
    if (r.ok) return r
    errs.push(r.error)
  }
  return { ok: false, error: 'all_failed', detail: errs.join(' | ') }
}
