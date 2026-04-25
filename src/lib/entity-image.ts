// 실존 책·제품·브랜드·장소의 실제 이미지 fetch
// 우선순위 (책):
//   1) Wikipedia 한국어 — 한국 책·작가 페이지에 표지 이미지 있는 경우
//   2) Google Books API — GOOGLE_BOOKS_API_KEY 있으면 키 사용 (없으면 quota exhaust 빈번)
//   3) Open Library covers — 영어 책에 강함, 한국어는 약함
// 우선순위 (제품·브랜드·장소):
//   1) Wikipedia 한국어 → 영어
// 모두 공식 API · 공개 라이센스 · 저작권 안전

export type EntityType = 'book' | 'product' | 'brand' | 'place'
export type EntityImageResult =
  | { ok: true; url: string; source: 'google_books' | 'wikipedia' | 'open_library' }
  | { ok: false; error: string }

// ─────────────────────────────────────────────
// Google Books API — 책 표지 (썸네일은 zoom 1, larger 는 zoom=2)
// ─────────────────────────────────────────────
async function fetchGoogleBooks(name: string): Promise<EntityImageResult> {
  try {
    const q = encodeURIComponent(`intitle:"${name}"`)
    const apiKeyParam = process.env.GOOGLE_BOOKS_API_KEY ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}` : ''
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=3&printType=books&langRestrict=ko${apiKeyParam}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return { ok: false, error: 'google_books_http' }
    const data = await res.json() as {
      items?: Array<{
        volumeInfo?: {
          title?: string
          imageLinks?: { thumbnail?: string; smallThumbnail?: string }
        }
      }>
    }
    const items = data.items || []
    for (const it of items) {
      const url = it.volumeInfo?.imageLinks?.thumbnail || it.volumeInfo?.imageLinks?.smallThumbnail
      if (url) {
        // http → https 보정 + zoom 파라미터로 큰 사이즈
        const upgraded = url.replace(/^http:/, 'https:').replace(/&zoom=\d+/, '&zoom=2')
        return { ok: true, url: upgraded, source: 'google_books' }
      }
    }
    // 한국 결과 없으면 영어로 다시 검색
    const enRes = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=3&printType=books`,
      { headers: { Accept: 'application/json' } }
    )
    if (enRes.ok) {
      const enData = await enRes.json() as {
        items?: Array<{ volumeInfo?: { imageLinks?: { thumbnail?: string } } }>
      }
      for (const it of enData.items || []) {
        const url = it.volumeInfo?.imageLinks?.thumbnail
        if (url) {
          return { ok: true, url: url.replace(/^http:/, 'https:').replace(/&zoom=\d+/, '&zoom=2'), source: 'google_books' }
        }
      }
    }
    return { ok: false, error: 'google_books_no_match' }
  } catch (e) {
    return { ok: false, error: 'google_books_exception: ' + String(e).slice(0, 100) }
  }
}

// ─────────────────────────────────────────────
// Wikipedia REST API — 페이지 메인 이미지
// 브랜드, 유명 장소, 공인된 제품에 적합
// ─────────────────────────────────────────────
async function fetchWikipedia(name: string, lang = 'ko'): Promise<EntityImageResult> {
  try {
    const q = encodeURIComponent(name)
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${q}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) {
      // 한국어 페이지 없으면 영어로 재시도
      if (lang === 'ko') return fetchWikipedia(name, 'en')
      return { ok: false, error: 'wiki_http' }
    }
    const data = await res.json() as {
      type?: string
      thumbnail?: { source?: string; width?: number; height?: number }
      originalimage?: { source?: string }
    }
    if (data.type === 'disambiguation') return { ok: false, error: 'wiki_ambiguous' }
    const url = data.originalimage?.source || data.thumbnail?.source
    if (!url) return { ok: false, error: 'wiki_no_image' }
    return { ok: true, url, source: 'wikipedia' }
  } catch (e) {
    return { ok: false, error: 'wiki_exception: ' + String(e).slice(0, 100) }
  }
}

// ─────────────────────────────────────────────
// Open Library — 책 표지 (Google Books 실패 시 fallback)
// ─────────────────────────────────────────────
async function fetchOpenLibrary(name: string): Promise<EntityImageResult> {
  try {
    const res = await fetch(
      `https://openlibrary.org/search.json?title=${encodeURIComponent(name)}&limit=3`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return { ok: false, error: 'openlib_http' }
    const data = await res.json() as { docs?: Array<{ cover_i?: number }> }
    const docs = data.docs || []
    for (const d of docs) {
      if (d.cover_i) {
        return { ok: true, url: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`, source: 'open_library' }
      }
    }
    return { ok: false, error: 'openlib_no_cover' }
  } catch (e) {
    return { ok: false, error: 'openlib_exception: ' + String(e).slice(0, 100) }
  }
}

// ─────────────────────────────────────────────
// 메인 디스패처
//   name (한국어) 우선, name_en (영어 원제) 도 받아서 fallback
// ─────────────────────────────────────────────
export async function fetchEntityImage(args: {
  type: EntityType
  name: string
  name_en?: string
}): Promise<EntityImageResult> {
  const name = (args.name || '').trim()
  const nameEn = (args.name_en || '').trim()
  if (!name && !nameEn) return { ok: false, error: 'no_name' }

  if (args.type === 'book') {
    // 1) Wikipedia 한국어 — 한국 책·작가
    if (name) {
      const w = await fetchWikipedia(name, 'ko')
      if (w.ok) return w
    }
    // 2) Google Books 한국어 (키 있으면 안정)
    if (name) {
      const g = await fetchGoogleBooks(name)
      if (g.ok) return g
    }
    // 3) Google Books 영어 원제로 재시도
    if (nameEn) {
      const ge = await fetchGoogleBooks(nameEn)
      if (ge.ok) return ge
    }
    // 4) Open Library — 영어 원제로 매칭률 매우 높음
    if (nameEn) {
      const oe = await fetchOpenLibrary(nameEn)
      if (oe.ok) return oe
    }
    if (name) {
      const o = await fetchOpenLibrary(name)
      if (o.ok) return o
    }
    return { ok: false, error: 'book_not_found' }
  }
  // 제품·브랜드·장소 → Wikipedia 한국어 → 영어 원제 → 영어
  if (name) {
    const w = await fetchWikipedia(name, 'ko')
    if (w.ok) return w
  }
  if (nameEn) {
    const we = await fetchWikipedia(nameEn, 'en')
    if (we.ok) return we
  }
  return { ok: false, error: 'entity_not_found' }
}
