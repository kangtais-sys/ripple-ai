// 카드뉴스 이미지 자동 fetch 체인
// 우선순위: Unsplash → Pexels → Pixabay
// 키가 없는 provider 는 자동 스킵. 전부 실패하면 { ok:false } → 프론트에서 placeholder 표시.
// AI 생성(Gemini/HeyGen) 제거 — 비용·저작권 이슈
//
// 환경변수:
//   UNSPLASH_ACCESS_KEY  — https://unsplash.com/developers (무료, 50req/hour)
//   PEXELS_API_KEY        — https://www.pexels.com/api/ (무료, 200req/hour)
//   PIXABAY_API_KEY       — https://pixabay.com/api/docs/ (무료, 100req/min)
//
// 카테고리별 영어 aesthetic 키워드로 자동 변환 (한국어 그대로 검색하면 결과 빈약)
// Pinterest 는 공개 API 없고 스크래핑은 TOS 위반 여지 → 제외

import type { CategoryKey } from './cardnews-prompt'

// Unsplash / Pexels Production 승인 요건: Photo by X on Unsplash 형식의 크레딧 필수.
// ImageResult 에 attributionUrl·photographer·sourceLabel 까지 담아 프론트에서 그대로 렌더링.
export type ImageResult =
  | {
      ok: true
      url: string
      source: 'unsplash' | 'pexels' | 'pixabay'
      sourceLabel: 'Unsplash' | 'Pexels' | 'Pixabay'
      photographer?: string
      attributionUrl?: string           // 사진 원본 페이지 (UTM 파라미터 포함, Unsplash 필수)
      photographerUrl?: string          // 작가 프로필 페이지 (Unsplash 필수)
    }
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
  book: [
    'vintage book aesthetic photography',
    'reading coffee aesthetic',
    'bookshelf aesthetic film',
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

// UTM 파라미터 — Unsplash API 가이드라인 필수 (Production 승인 요건)
// https://help.unsplash.com/en/articles/2511245
const UTM = 'utm_source=ssobi&utm_medium=referral'

// ─────────────────────────────────────────────
// 각 provider — 키 없으면 { ok:false } 즉시 반환
// ─────────────────────────────────────────────
async function fetchUnsplash(q: string): Promise<ImageResult> {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) return { ok: false, error: 'unsplash_no_key' }
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=10&orientation=squarish&content_filter=high`,
      { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } }
    )
    if (!res.ok) return { ok: false, error: 'unsplash_http', detail: `${res.status}` }
    const data = await res.json() as {
      results?: Array<{
        id?: string
        urls?: { regular?: string; small?: string }
        links?: { html?: string; download_location?: string }
        user?: { name?: string; username?: string; links?: { html?: string } }
      }>
    }
    const results = data.results || []
    if (!results.length) return { ok: false, error: 'unsplash_empty' }
    // 상위 10개 중 3~9번째 랜덤 (상단 광고성 제외)
    const pool = results.slice(3, 10)
    const pick = (pool.length ? pool : results)[Math.floor(Math.random() * Math.max(1, (pool.length ? pool.length : results.length)))]
    const url = pick?.urls?.regular || pick?.urls?.small
    if (!url) return { ok: false, error: 'unsplash_no_url' }
    // Unsplash 가이드: download_location 에 GET (키 포함) 을 non-blocking 으로 호출해 다운로드 카운트 증가
    if (pick.links?.download_location) {
      fetch(`${pick.links.download_location}&client_id=${key}`).catch(() => {})
    }
    return {
      ok: true,
      url,
      source: 'unsplash',
      sourceLabel: 'Unsplash',
      photographer: pick.user?.name,
      attributionUrl: pick.links?.html ? `${pick.links.html}?${UTM}` : undefined,
      photographerUrl: pick.user?.links?.html ? `${pick.user.links.html}?${UTM}` : undefined,
    }
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
      photos?: Array<{
        id?: number
        url?: string
        src?: { large?: string; large2x?: string; medium?: string }
        photographer?: string
        photographer_url?: string
      }>
    }
    const photos = data.photos || []
    if (!photos.length) return { ok: false, error: 'pexels_empty' }
    const pool = photos.slice(3, 10)
    const pick = (pool.length ? pool : photos)[Math.floor(Math.random() * Math.max(1, (pool.length ? pool.length : photos.length)))]
    const url = pick?.src?.large2x || pick?.src?.large || pick?.src?.medium
    if (!url) return { ok: false, error: 'pexels_no_url' }
    return {
      ok: true,
      url,
      source: 'pexels',
      sourceLabel: 'Pexels',
      photographer: pick.photographer,
      attributionUrl: pick.url,
      photographerUrl: pick.photographer_url,
    }
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
      hits?: Array<{
        pageURL?: string
        largeImageURL?: string
        webformatURL?: string
        user?: string
        user_id?: number
      }>
    }
    const hits = data.hits || []
    if (!hits.length) return { ok: false, error: 'pixabay_empty' }
    const pool = hits.slice(3, 15)
    const pick = (pool.length ? pool : hits)[Math.floor(Math.random() * Math.max(1, (pool.length ? pool.length : hits.length)))]
    const url = pick?.largeImageURL || pick?.webformatURL
    if (!url) return { ok: false, error: 'pixabay_no_url' }
    return {
      ok: true,
      url,
      source: 'pixabay',
      sourceLabel: 'Pixabay',
      photographer: pick.user,
      attributionUrl: pick.pageURL,
      photographerUrl: pick.user_id ? `https://pixabay.com/users/${pick.user_id}/` : undefined,
    }
  } catch (e) {
    return { ok: false, error: 'pixabay_exception', detail: String(e).slice(0, 200) }
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
// Unsplash → Pexels → Pixabay. 전부 실패하면 프론트가 placeholder 렌더.
// ─────────────────────────────────────────────
export async function fetchCardnewsImage(args: {
  koKeyword?: string
  category?: CategoryKey
  slideIdx?: number
}): Promise<ImageResult> {
  const enQuery = cleanQuery(toEnKeyword(args))
  const errs: string[] = []
  for (const provider of [fetchUnsplash, fetchPexels, fetchPixabay]) {
    const r = await provider(enQuery)
    if (r.ok) return r
    errs.push(r.error)
  }
  return { ok: false, error: 'all_failed', detail: errs.join(' | ') }
}
