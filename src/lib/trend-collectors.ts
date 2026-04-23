// 트렌드 수집기 — 매일 23:00 cron 이 실행
// API 키 없이 공개된 엔드포인트/RSS 만 사용.
// 실제 2026-04 smoke test 로 status 200 확인된 소스만 활성.
// 차단된 소스(OliveYoung·Musinsa·Trends24)는 주석만 남겨둠 — 우회 경로 찾으면 복구.
//
// 활성 소스 (전부 키 불필요):
//   ✅ Reddit public JSON
//   ✅ Google Trends Korea RSS  (trending/rss?geo=KR)
//   ✅ Signal.bz 실시간 검색어  (네이버/다음/줌/네이트 통합)
//   ✅ Hacker News Algolia API
//   ✅ Product Hunt RSS
//   ✅ Lifehacker RSS  (라이프 팁 글로벌)
//   ✅ 연합뉴스 문화·생활 RSS  (국내 라이프)
//
// 공통 주의: 바깥 사이트라 레이아웃·정책 바뀌면 실패 가능 → 전부 soft-fail.

export type FeedItem = {
  source: string
  title: string
  excerpt?: string
  engagement?: number       // 정규화 점수 0~100
  url?: string
  raw?: Record<string, unknown>
}

// 실제 브라우저 UA (봇 차단 회피용). Reddit 은 이 UA 없으면 403.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

async function safeFetch(url: string, opts?: RequestInit): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      ...opts,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
        ...(opts?.headers || {}),
      },
    })
    if (!res.ok) return null
    return res
  } catch {
    return null
  }
}

async function safeJson<T>(url: string, opts?: RequestInit): Promise<T | null> {
  const res = await safeFetch(url, { ...opts, headers: { Accept: 'application/json, */*', ...(opts?.headers || {}) } })
  if (!res) return null
  try { return await res.json() as T } catch { return null }
}

async function safeText(url: string, opts?: RequestInit): Promise<string | null> {
  const res = await safeFetch(url, opts)
  if (!res) return null
  try { return await res.text() } catch { return null }
}

// RSS 공통 파서 — <item><title>·<description>·<link> 추출
function parseRssItems(xml: string, limit = 15): Array<{ title: string; excerpt: string; link: string }> {
  const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0, limit)
  return items.map(m => {
    const block = m[1]
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || '').trim()
    const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim()
    const desc = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] || '').trim()
    return {
      title,
      link,
      excerpt: desc.replace(/<[^>]+>/g, '').slice(0, 200),
    }
  }).filter(x => x.title.length > 0)
}

// ─────────────────────────────────────────────
// Reddit — public JSON (.json 엔드포인트)
// 뷰티·라이프·여행·음식 서브 다양하게
// ─────────────────────────────────────────────
const REDDIT_SUBS = [
  'SkincareAddiction', 'AsianBeauty', 'beauty', 'MakeupAddiction', 'koreanbeauty',
  'LifeProTips', 'travel', 'food', 'Cooking',
]

export async function fetchReddit(limit = 4): Promise<FeedItem[]> {
  const results: FeedItem[] = []
  for (const sub of REDDIT_SUBS) {
    const data = await safeJson<{ data?: { children?: Array<{ data?: {
      title?: string; selftext?: string; ups?: number; permalink?: string; url?: string
    }}>}}>(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=${limit}`)
    const children = data?.data?.children || []
    for (const c of children) {
      const d = c.data
      if (!d?.title) continue
      results.push({
        source: `reddit:r/${sub}`,
        title: d.title,
        excerpt: (d.selftext || '').slice(0, 200),
        engagement: Math.min(100, (d.ups || 0) / 10),
        url: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url,
      })
    }
  }
  return results
}

// ─────────────────────────────────────────────
// Google Trends Korea — RSS (공식 공개 피드, 키 불필요)
// 매일 한국 급상승 검색어 + 관련 뉴스 스니펫 제공
// ─────────────────────────────────────────────
export async function fetchGoogleTrendsKR(): Promise<FeedItem[]> {
  const xml = await safeText('https://trends.google.com/trending/rss?geo=KR')
  if (!xml) return []
  const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0, 20)
  return items.map((m, i) => {
    const block = m[1]
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || '').trim()
    const trafficRaw = block.match(/<ht:approx_traffic>([^<]+)<\/ht:approx_traffic>/)?.[1] || '0'
    const traffic = parseInt(trafficRaw.replace(/[^\d]/g, '')) || 0
    // 첫 번째 뉴스 스니펫 / 타이틀 추출
    const newsTitle = (block.match(/<ht:news_item_title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/ht:news_item_title>/)?.[1] || '').trim()
    const newsUrl = (block.match(/<ht:news_item_url>([\s\S]*?)<\/ht:news_item_url>/)?.[1] || '').trim()
    return {
      source: 'google_trends:kr',
      title,
      excerpt: newsTitle.slice(0, 200),
      engagement: Math.min(100, traffic / 100 + (20 - i)),
      url: newsUrl || undefined,
    }
  }).filter(x => x.title.length > 0)
}

// ─────────────────────────────────────────────
// Signal.bz — 네이버/다음/줌/네이트 실시간 검색어 통합
// (국내 실검 대체 · 공개 JSON)
// ─────────────────────────────────────────────
export async function fetchSignalBz(): Promise<FeedItem[]> {
  const data = await safeJson<{ top10?: Array<{ rank?: number; keyword?: string; state?: string }> }>(
    'https://api.signal.bz/news/realtime'
  )
  const list = data?.top10 || []
  return list.slice(0, 10).map((k) => ({
    source: 'signalbz:realtime',
    title: k.keyword || '',
    engagement: Math.max(0, 100 - (k.rank || 1) * 5),
    url: `https://search.naver.com/search.naver?query=${encodeURIComponent(k.keyword || '')}`,
  })).filter(x => x.title.length > 0)
}

// ─────────────────────────────────────────────
// Hacker News (Algolia public API · 키 불필요)
// 글로벌 테크·라이프해커 인기글
// ─────────────────────────────────────────────
export async function fetchHackerNews(): Promise<FeedItem[]> {
  const data = await safeJson<{ hits?: Array<{
    title?: string; url?: string; points?: number; num_comments?: number
  }>}>(
    'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=15'
  )
  const hits = data?.hits || []
  return hits.map(h => ({
    source: 'hackernews:frontpage',
    title: h.title || '',
    engagement: Math.min(100, ((h.points || 0) + (h.num_comments || 0)) / 10),
    url: h.url,
  })).filter(x => x.title.length > 0)
}

// ─────────────────────────────────────────────
// Product Hunt RSS — 오늘의 제품 트렌드
// ─────────────────────────────────────────────
export async function fetchProductHunt(): Promise<FeedItem[]> {
  const xml = await safeText('https://www.producthunt.com/feed')
  if (!xml) return []
  return parseRssItems(xml, 10).map((it, i) => ({
    source: 'producthunt:daily',
    title: it.title,
    excerpt: it.excerpt,
    engagement: Math.max(0, 50 - i * 2),
    url: it.link,
  }))
}

// ─────────────────────────────────────────────
// Lifehacker RSS — 글로벌 라이프 팁
// ─────────────────────────────────────────────
export async function fetchLifehacker(): Promise<FeedItem[]> {
  const xml = await safeText('https://lifehacker.com/feed/rss')
  if (!xml) return []
  return parseRssItems(xml, 10).map((it, i) => ({
    source: 'lifehacker:feed',
    title: it.title,
    excerpt: it.excerpt,
    engagement: Math.max(0, 40 - i * 2),
    url: it.link,
  }))
}

// ─────────────────────────────────────────────
// 연합뉴스 생활·문화 RSS — 국내 라이프 피드
// ─────────────────────────────────────────────
export async function fetchYonhapLife(): Promise<FeedItem[]> {
  const xml = await safeText('https://www.yna.co.kr/rss/culture.xml')
  if (!xml) return []
  return parseRssItems(xml, 10).map((it, i) => ({
    source: 'yonhap:culture',
    title: it.title,
    excerpt: it.excerpt,
    engagement: Math.max(0, 40 - i * 2),
    url: it.link,
  }))
}

// ─────────────────────────────────────────────
// 통합 수집기 — 병렬 실행, 실패는 빈 배열로 흡수
// ─────────────────────────────────────────────
export async function collectAllTrends(): Promise<{
  items: FeedItem[]
  stats: Record<string, number>
}> {
  const [reddit, googleTrends, signalbz, hn, ph, lh, yna] = await Promise.all([
    fetchReddit(3).catch(() => [] as FeedItem[]),
    fetchGoogleTrendsKR().catch(() => [] as FeedItem[]),
    fetchSignalBz().catch(() => [] as FeedItem[]),
    fetchHackerNews().catch(() => [] as FeedItem[]),
    fetchProductHunt().catch(() => [] as FeedItem[]),
    fetchLifehacker().catch(() => [] as FeedItem[]),
    fetchYonhapLife().catch(() => [] as FeedItem[]),
  ])
  const items = [
    ...reddit, ...googleTrends, ...signalbz,
    ...hn, ...ph, ...lh, ...yna,
  ]
  return {
    items,
    stats: {
      reddit: reddit.length,
      google_trends: googleTrends.length,
      signalbz: signalbz.length,
      hackernews: hn.length,
      producthunt: ph.length,
      lifehacker: lh.length,
      yonhap: yna.length,
      total: items.length,
    },
  }
}

// engagement 내림차순 + 소스 다양성 보장 (한 소스 최대 6)
export function rankTopN(items: FeedItem[], n: number): FeedItem[] {
  const sorted = [...items].sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
  const perSource: Record<string, number> = {}
  const picked: FeedItem[] = []
  for (const it of sorted) {
    const src = it.source.split(':')[0]
    if ((perSource[src] || 0) >= 6) continue
    picked.push(it)
    perSource[src] = (perSource[src] || 0) + 1
    if (picked.length >= n) break
  }
  return picked
}
