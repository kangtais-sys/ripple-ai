// 트렌드 수집기 — 매일 23:00 cron 이 실행
// 2026-04 업데이트: 더쿠/클리앙 RSS 차단 → YouTube Trending KR + 한국 뉴스 RSS 로 교체
//                  네이버 데이터랩 → NewsAPI.org 로 교체
//
// 활성 소스:
//   ✅ Google Trends Korea RSS  (trending/rss?geo=KR)
//   ✅ Signal.bz 실시간 검색어  (네이버/다음/줌/네이트 통합)
//   ✅ Hacker News Algolia API
//   ✅ YouTube Trending KR + 한경/매경 뉴스 RSS  (collectKoreanTrends, YOUTUBE_API_KEY)
//   ✅ Lifehacker RSS  (라이프 팁 글로벌)
//   ✅ 연합뉴스 문화·생활 RSS  (국내 라이프)
//   ✅ NewsAPI.org top-headlines KR  (collectNewsAPI, NEWS_API_KEY)
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
// 한국 트렌드 — YouTube Trending KR + 한경/매경 뉴스 RSS
// 2026-04 디버그: 네이버 뉴스 RSS(news.naver.com/rss/ranking.xml) 폐지로 404
//                대신 한경(hankyung)·매경(mk) 메인 RSS 사용 (둘 다 200, items 50)
// 사용자 요청한 "YouTube Trending KR + 한국 뉴스" 결합형.
// ─────────────────────────────────────────────
export async function collectKoreanTrends(): Promise<FeedItem[]> {
  const items: FeedItem[] = []

  // 1) YouTube Trending KR (영상 제목 20개) — YOUTUBE_API_KEY 필요
  const ytKey = process.env.YOUTUBE_API_KEY
  console.log('[collectKoreanTrends] youtube key present:', !!ytKey)
  if (ytKey) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&regionCode=KR&maxResults=20&key=${ytKey}`
      const res = await fetch(url)
      console.log('[collectKoreanTrends] youtube response status:', res.status)
      if (res.ok) {
        const data = await res.json() as {
          items?: Array<{
            id?: string
            snippet?: { title?: string; description?: string; channelTitle?: string; tags?: string[] }
          }>
        }
        ;(data.items || []).forEach((v, i) => {
          const t = v.snippet?.title?.trim()
          if (!t) return
          items.push({
            source: 'youtube:trending_kr',
            title: t,
            excerpt: (v.snippet?.description || '').slice(0, 200),
            engagement: Math.max(0, 80 - i * 2),
            url: v.id ? `https://www.youtube.com/watch?v=${v.id}` : undefined,
          })
        })
      } else {
        const errBody = await res.text().catch(() => '')
        console.warn('[collectKoreanTrends] youtube error body:', errBody.slice(0, 300))
      }
    } catch (e) {
      console.error('[collectKoreanTrends] youtube exception:', e)
    }
  } else {
    console.warn('[collectKoreanTrends] missing YOUTUBE_API_KEY → youtube skip')
  }

  // 2) 한국 뉴스 RSS — 네이버 뉴스 RSS 폐지(404) → 한경 + 매경
  const [hkXml, mkXml] = await Promise.all([
    safeText('https://www.hankyung.com/feed/all-news'),
    safeText('https://www.mk.co.kr/rss/30000001/'),
  ])
  console.log('[collectKoreanTrends] hankyung fetched:', !!hkXml, 'len', hkXml?.length || 0)
  console.log('[collectKoreanTrends] mk fetched:', !!mkXml, 'len', mkXml?.length || 0)

  if (hkXml) {
    const hkParsed = parseRssItems(hkXml, 8)
    console.log('[collectKoreanTrends] hankyung parsed items:', hkParsed.length, 'first:', hkParsed[0]?.title?.slice(0, 60) || '(none)')
    hkParsed.forEach((it, i) => {
      items.push({
        source: 'hankyung:news',
        title: it.title,
        excerpt: it.excerpt,
        engagement: Math.max(0, 45 - i * 2),
        url: it.link,
      })
    })
  } else {
    console.warn('[collectKoreanTrends] hankyung fetch failed')
  }
  if (mkXml) {
    const mkParsed = parseRssItems(mkXml, 8)
    console.log('[collectKoreanTrends] mk parsed items:', mkParsed.length, 'first:', mkParsed[0]?.title?.slice(0, 60) || '(none)')
    mkParsed.forEach((it, i) => {
      items.push({
        source: 'mk:news',
        title: it.title,
        excerpt: it.excerpt,
        engagement: Math.max(0, 45 - i * 2),
        url: it.link,
      })
    })
  } else {
    console.warn('[collectKoreanTrends] mk fetch failed')
  }

  console.log('[collectKoreanTrends] total items:', items.length)
  return items.slice(0, 30)
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
// NewsAPI.org — everything?q=한국&language=ko&sortBy=popularity
// (NEWS_API_KEY 필요, 무료 dev 1000건/일)
// 무료 플랜은 top-headlines?country=kr 미지원 → everything 엔드포인트로 우회.
// ─────────────────────────────────────────────
export async function collectNewsAPI(): Promise<FeedItem[]> {
  const key = process.env.NEWS_API_KEY
  console.log('[collectNewsAPI] env key present:', !!key)
  if (!key) {
    console.warn('[collectNewsAPI] missing NEWS_API_KEY → skip')
    return []
  }
  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent('한국')}&language=ko&sortBy=popularity&pageSize=20&apiKey=${key}`
    const res = await fetch(url)
    console.log('[collectNewsAPI] response status:', res.status)
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.warn('[collectNewsAPI] error body:', errBody.slice(0, 300))
      return []
    }
    const data = await res.json() as {
      status?: string
      totalResults?: number
      articles?: Array<{
        title?: string
        description?: string
        url?: string
        source?: { name?: string }
      }>
    }
    console.log('[collectNewsAPI] articles count:', (data.articles || []).length, 'total:', data.totalResults)
    return (data.articles || []).map((a, i) => ({
      source: `newsapi:${a.source?.name || 'ko'}`,
      title: a.title || '',
      excerpt: (a.description || '').slice(0, 200),
      engagement: Math.max(0, 60 - i * 2),
      url: a.url,
    })).filter(x => x.title.length > 0)
  } catch (e) {
    console.error('[collectNewsAPI] exception:', e)
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
  const [googleTrends, signalbz, hn, koreanTrends, lh, yna, newsApi] = await Promise.all([
    fetchGoogleTrendsKR().catch(() => [] as FeedItem[]),
    fetchSignalBz().catch(() => [] as FeedItem[]),
    fetchHackerNews().catch(() => [] as FeedItem[]),
    collectKoreanTrends().catch(() => [] as FeedItem[]),
    fetchLifehacker().catch(() => [] as FeedItem[]),
    fetchYonhapLife().catch(() => [] as FeedItem[]),
    collectNewsAPI().catch(() => [] as FeedItem[]),
  ])
  const items = [
    ...googleTrends, ...signalbz,
    ...hn, ...koreanTrends, ...lh, ...yna, ...newsApi,
  ]
  return {
    items,
    stats: {
      google_trends: googleTrends.length,
      signalbz: signalbz.length,
      hackernews: hn.length,
      korean_trends: koreanTrends.length,
      lifehacker: lh.length,
      yonhap: yna.length,
      news_api: newsApi.length,
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
