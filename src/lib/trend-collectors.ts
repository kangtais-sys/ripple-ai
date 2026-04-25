// 트렌드 수집기 — 매일 23:00 cron 이 실행
// 2026-04 업데이트: ProductHunt RSS 단종 → 더쿠+클리앙 / Reddit 제거 (글로벌이라 K-MZ 적합도 낮음)
//
// 활성 소스:
//   ✅ Google Trends Korea RSS  (trending/rss?geo=KR)
//   ✅ Signal.bz 실시간 검색어  (네이버/다음/줌/네이트 통합)
//   ✅ Hacker News Algolia API
//   ✅ 더쿠 핫게 + 클리앙 RSS  (한국 커뮤니티)
//   ✅ Lifehacker RSS  (라이프 팁 글로벌)
//   ✅ 연합뉴스 문화·생활 RSS  (국내 라이프)
//   ✅ 네이버 데이터랩 검색 추이  (NAVER_CLIENT_ID/SECRET 필요)
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

// 실제 브라우저 UA (봇 차단 회피용)
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
// Google Trends Korea — RSS (공식 공개 피드, 키 불필요)
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
// 한국 커뮤니티 — 더쿠 핫게 + 클리앙 RSS (구 ProductHunt 자리)
// ProductHunt RSS 는 단종 → K-MZ 에 더 적합한 한국 커뮤니티로 교체
// ─────────────────────────────────────────────
export async function collectKoreanCommunity(): Promise<FeedItem[]> {
  const [theqooXml, clienXml] = await Promise.all([
    safeText('https://theqoo.net/index.php?mid=hot&act=rss'),
    safeText('https://www.clien.net/service/rss'),
  ])
  const items: FeedItem[] = []

  // 더쿠 핫게 — 광고/공지 키워드 제외
  if (theqooXml) {
    parseRssItems(theqooXml, 12).forEach((it, i) => {
      if (/공지|광고|이벤트\s*당첨|광고문의/.test(it.title)) return
      items.push({
        source: 'theqoo:hot',
        title: it.title,
        excerpt: it.excerpt,
        engagement: Math.max(0, 55 - i * 2),
        url: it.link,
      })
    })
  }

  // 클리앙 — 광고/공지 제외
  if (clienXml) {
    parseRssItems(clienXml, 12).forEach((it, i) => {
      if (/공지|광고|판매|구매/.test(it.title)) return
      items.push({
        source: 'clien:rss',
        title: it.title,
        excerpt: it.excerpt,
        engagement: Math.max(0, 50 - i * 2),
        url: it.link,
      })
    })
  }

  return items.slice(0, 20)
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
// 네이버 데이터랩 — 미리 정의된 K-MZ 핫 키워드 그룹의 최근 7일 검색 추이
// 네이버는 2021년 실시간 급상승을 폐지 → datalab.search API 로 키워드 그룹 추이 측정.
// 환경변수 없으면 빈 배열 (graceful fail).
// ─────────────────────────────────────────────
const NAVER_KEYWORD_GROUPS = [
  { groupName: '뷰티 핫이슈', keywords: ['올리브영', '닥터지', '메디큐브', '토리든'] },
  { groupName: '카페 트렌드', keywords: ['스타벅스 신메뉴', '런던베이글뮤지엄', '컴포즈커피', '블루보틀'] },
  { groupName: '쇼핑 핫템', keywords: ['무신사', '다이소', '이케아', '쿠팡'] },
  { groupName: '푸드 트렌드', keywords: ['편의점 신메뉴', '에어프라이어 레시피', '백종원 레시피', '망원동 맛집'] },
  { groupName: '여행 핫플', keywords: ['제주 여행', '도쿄 여행', '오사카 여행', '강릉 카페'] },
  { groupName: '라이프 트렌드', keywords: ['1인 가구 가전', '미니멀 라이프', '홈인테리어', '자취템'] },
]

export async function collectNaverTrends(): Promise<FeedItem[]> {
  const id = process.env.NAVER_CLIENT_ID
  const secret = process.env.NAVER_CLIENT_SECRET
  if (!id || !secret) return []
  const today = new Date()
  const start = new Date(today.getTime() - 30 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  try {
    const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
      method: 'POST',
      headers: {
        'X-Naver-Client-Id': id,
        'X-Naver-Client-Secret': secret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: fmt(start),
        endDate: fmt(today),
        timeUnit: 'date',
        keywordGroups: NAVER_KEYWORD_GROUPS,
      }),
    })
    if (!res.ok) return []
    const data = await res.json() as {
      results?: Array<{
        title?: string
        keywords?: string[]
        data?: Array<{ period: string; ratio: number }>
      }>
    }
    const items: FeedItem[] = []
    ;(data.results || []).forEach(r => {
      if (!r.title || !r.keywords) return
      const recent = (r.data || []).slice(-7)
      const avg = recent.length ? recent.reduce((a, b) => a + (b.ratio || 0), 0) / recent.length : 0
      r.keywords.forEach((kw, i) => {
        items.push({
          source: 'naver:datalab',
          title: kw,
          excerpt: `${r.title} · 최근 7일 검색 비율 ${avg.toFixed(1)}`,
          engagement: Math.min(100, avg + (10 - i * 2)),
          url: `https://search.naver.com/search.naver?query=${encodeURIComponent(kw)}`,
        })
      })
    })
    return items.slice(0, 12)
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────
// 통합 수집기 — 병렬 실행, 실패는 빈 배열로 흡수
// ─────────────────────────────────────────────
export async function collectAllTrends(): Promise<{
  items: FeedItem[]
  stats: Record<string, number>
}> {
  const [googleTrends, signalbz, hn, koreanCommunity, lh, yna, naver] = await Promise.all([
    fetchGoogleTrendsKR().catch(() => [] as FeedItem[]),
    fetchSignalBz().catch(() => [] as FeedItem[]),
    fetchHackerNews().catch(() => [] as FeedItem[]),
    collectKoreanCommunity().catch(() => [] as FeedItem[]),
    fetchLifehacker().catch(() => [] as FeedItem[]),
    fetchYonhapLife().catch(() => [] as FeedItem[]),
    collectNaverTrends().catch(() => [] as FeedItem[]),
  ])
  const items = [
    ...googleTrends, ...signalbz,
    ...hn, ...koreanCommunity, ...lh, ...yna, ...naver,
  ]
  return {
    items,
    stats: {
      google_trends: googleTrends.length,
      signalbz: signalbz.length,
      hackernews: hn.length,
      korean_community: koreanCommunity.length,
      lifehacker: lh.length,
      yonhap: yna.length,
      naver_datalab: naver.length,
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
