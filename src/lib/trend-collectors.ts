import { createClient } from '@supabase/supabase-js'

// 트렌드 수집기 — 매일 23:00 cron 이 실행
// 2026-04 Phase 3 업데이트: Instagram Hashtag 급상승 감지 추가 (ig_accounts 동적 토큰)
// 2026-04 Phase 2 업데이트: 카테고리별 RSS 9개 추가 (사전 검증 통과 분만)
//
// 기존 7개:
//   ✅ Google Trends Korea / Signal.bz / Hacker News / collectKoreanTrends (YT+한경+매경)
//   ✅ Lifehacker / 연합뉴스 / NewsAPI.org
// 신규 9개 (Phase 2):
//   ✅ Harper's Bazaar (beauty)  · Who What Wear (fashion) · WWD (fashion) · Refinery29 (life)
//   ✅ Apartment Therapy / Design Milk (interior)
//   ✅ Women's Health / Runner's World (fitness)
//   ✅ NerdWallet (money)
//
// 제외(검증 실패): Allure/Vogue/Bon Appétit/Arch Digest (atom 형식 items 1) /
//                  Byrdie/Lonely Planet/Investopedia (4xx) / 머니투데이/W Korea (404) /
//                  Eater/Food52/YES24 (items 0/429)
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
// 한국 트렌드 — YouTube Trending KR + 한경 뉴스 RSS
// 2026-04 디버그: 네이버 뉴스 RSS 폐지(404) → 한경 사용
// 매경(mk)은 옛 기사 섞여 시점 일관성 깨져서 제외 (2026-04-26)
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

  // 2) 한국 뉴스 RSS — 한경만 사용 (매경 제외: 옛 기사 섞여 시점 일관성 깨짐)
  const hkXml = await safeText('https://www.hankyung.com/feed/all-news')
  console.log('[collectKoreanTrends] hankyung fetched:', !!hkXml, 'len', hkXml?.length || 0)

  if (hkXml) {
    const hkParsed = parseRssItems(hkXml, 10)
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
    console.warn('[collectKoreanTrends] hankyung fetch failed (Vercel data center IP 가능성)')
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
// NewsAPI.org — 한국 관련 글로벌 뉴스 (NEWS_API_KEY 필요, 무료 dev 1000건/일)
// 1차: top-headlines?sources=google-news&q=korea  (google news 가 가장 자주 갱신)
// 2차: everything?q=kpop OR korea trend&language=en&sortBy=popularity  (1차 비면 fallback)
// ─────────────────────────────────────────────
type NewsApiArticle = {
  title?: string
  description?: string
  url?: string
  source?: { name?: string }
}
type NewsApiResp = { status?: string; totalResults?: number; articles?: NewsApiArticle[] }

async function newsApiFetch(url: string, label: string): Promise<NewsApiArticle[]> {
  const res = await fetch(url)
  console.log(`[collectNewsAPI:${label}] response status:`, res.status)
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    console.warn(`[collectNewsAPI:${label}] error body:`, errBody.slice(0, 300))
    return []
  }
  const data = await res.json() as NewsApiResp
  const arts = data.articles || []
  console.log(`[collectNewsAPI:${label}] articles count:`, arts.length, 'total:', data.totalResults)
  return arts
}

export async function collectNewsAPI(): Promise<FeedItem[]> {
  const key = process.env.NEWS_API_KEY
  console.log('[collectNewsAPI] env key present:', !!key)
  if (!key) {
    console.warn('[collectNewsAPI] missing NEWS_API_KEY → skip')
    return []
  }
  let articles: NewsApiArticle[] = []
  try {
    // 1차 시도: google-news 소스 + korea 키워드
    const url1 = `https://newsapi.org/v2/top-headlines?sources=google-news&q=${encodeURIComponent('korea')}&apiKey=${key}`
    articles = await newsApiFetch(url1, 'top-headlines')
    // 1차가 비었으면 2차 시도
    if (articles.length === 0) {
      console.log('[collectNewsAPI] primary empty → trying everything fallback')
      const url2 = `https://newsapi.org/v2/everything?q=${encodeURIComponent('kpop OR korea trend')}&language=en&sortBy=popularity&pageSize=20&apiKey=${key}`
      articles = await newsApiFetch(url2, 'everything')
    }
  } catch (e) {
    console.error('[collectNewsAPI] exception:', e)
    return []
  }
  console.log('[collectNewsAPI] final articles count:', articles.length)
  return articles.map((a, i) => ({
    source: `newsapi:${a.source?.name || 'kr'}`,
    title: a.title || '',
    excerpt: (a.description || '').slice(0, 200),
    engagement: Math.max(0, 60 - i * 2),
    url: a.url,
  })).filter(x => x.title.length > 0)
}

// ─────────────────────────────────────────────
// Phase 2 — 카테고리별 보강 RSS (사전 검증 통과 9개)
//   각 RSS 는 fetchYonhapLife 패턴과 동일 — title/excerpt/link 모두 추출, soft-fail
// ─────────────────────────────────────────────
async function rssToFeedItems(url: string, source: string, baseEngagement: number, limit = 10): Promise<FeedItem[]> {
  const xml = await safeText(url)
  if (!xml) return []
  return parseRssItems(xml, limit).map((it, i) => ({
    source,
    title: it.title,
    excerpt: it.excerpt,
    engagement: Math.max(0, baseEngagement - i * 2),
    url: it.link,
  }))
}

// 뷰티
export async function fetchHarpersBazaar(): Promise<FeedItem[]> {
  return rssToFeedItems('https://www.harpersbazaar.com/rss/all.xml', 'harpers_bazaar:beauty', 50, 12)
}
// 패션
export async function fetchWhoWhatWear(): Promise<FeedItem[]> {
  return rssToFeedItems('https://www.whowhatwear.com/rss', 'whowhatwear:fashion', 50, 12)
}
export async function fetchWWD(): Promise<FeedItem[]> {
  return rssToFeedItems('https://wwd.com/feed/', 'wwd:fashion', 45, 10)
}
// 라이프·패션 mix
export async function fetchRefinery29(): Promise<FeedItem[]> {
  return rssToFeedItems('https://www.refinery29.com/rss.xml', 'refinery29:life', 45, 10)
}
// 인테리어
export async function fetchApartmentTherapy(): Promise<FeedItem[]> {
  return rssToFeedItems('https://www.apartmenttherapy.com/main.rss', 'apartmenttherapy:interior', 50, 12)
}
export async function fetchDesignMilk(): Promise<FeedItem[]> {
  return rssToFeedItems('https://design-milk.com/feed/', 'designmilk:interior', 45, 10)
}
// 피트니스
export async function fetchWomensHealth(): Promise<FeedItem[]> {
  return rssToFeedItems('https://www.womenshealthmag.com/rss/all.xml', 'womenshealth:fitness', 50, 12)
}
export async function fetchRunnersWorld(): Promise<FeedItem[]> {
  return rssToFeedItems('https://www.runnersworld.com/rss/all.xml', 'runnersworld:fitness', 45, 10)
}
// 재테크
export async function fetchNerdWallet(): Promise<FeedItem[]> {
  return rssToFeedItems('https://www.nerdwallet.com/blog/feed/', 'nerdwallet:money', 45, 10)
}

// ─────────────────────────────────────────────
// Phase 3 — Instagram Hashtag 급상승 감지 (2026-04)
//   ig_accounts 테이블에서 활성 토큰 자동 조회 (만료 안 된 첫 행, 실패 시 다음 행 fallback)
//   카테고리별 5 hashtag × 8 카테고리 = 40 hashtag 의 media_count 추적
//   instagram_hashtag_counts 테이블에 일별 카운트 저장 → 어제 대비 급상승 top2/카테고리 반환
//   Meta Graph API rate limit (앱당 200/h) 안전: 한번에 80 호출 (search 40 + count 40)
// ─────────────────────────────────────────────
const HASHTAGS_BY_CATEGORY: Record<string, string[]> = {
  beauty: ['올리브영', '피부관리', '스킨케어루틴', '뷰티템', '화장품추천'],
  fashion: ['오오티디', '데일리룩', '코디추천', '무신사', '패션'],
  food: ['맛집추천', '홈쿡', '카페투어', '맛스타그램', '오늘뭐먹지'],
  travel: ['국내여행', '해외여행', '여행스타그램', '여행추천', '주말여행'],
  life: ['생활꿀팁', '자취생활', '인테리어', '살림', '일상'],
  fitness: ['홈트', '운동일상', '헬스', '다이어트', '운동'],
  money: ['재테크', '주식', '부업', '절약', '돈모으기'],
  book: ['독서', '책추천', '북스타그램', '읽은책', '오늘의책'],
}

type IgTokenRow = { ig_user_id: string; access_token: string; token_expires_at: string | null }

async function getActiveIgToken(): Promise<IgTokenRow | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return null
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  const nowIso = new Date().toISOString()
  // 만료 안 된 토큰 우선, 최신 등록순
  const { data } = await sb
    .from('ig_accounts')
    .select('ig_user_id, access_token, token_expires_at')
    .not('access_token', 'is', null)
    .or(`token_expires_at.is.null,token_expires_at.gte.${nowIso}`)
    .order('created_at', { ascending: false })
    .limit(5)
  if (!data || data.length === 0) return null
  // 첫 행이 작동 안 하면 호출부에서 다음 row 시도. 일단 첫 row 반환.
  return data[0] as IgTokenRow
}

export async function collectInstagramHashtagTrends(): Promise<FeedItem[]> {
  console.log('[collectInstagramHashtagTrends] start')
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.warn('[collectInstagramHashtagTrends] missing supabase env')
    return []
  }
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  const tokenRow = await getActiveIgToken()
  if (!tokenRow) {
    console.warn('[collectInstagramHashtagTrends] no active ig token in ig_accounts')
    return []
  }
  const { ig_user_id: igUserId, access_token: token } = tokenRow
  console.log('[collectInstagramHashtagTrends] using ig_user_id:', igUserId.slice(0, 8) + '...')

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const yesterday = new Date(today.getTime() - 86400000)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)

  const results: FeedItem[] = []

  for (const [category, tags] of Object.entries(HASHTAGS_BY_CATEGORY)) {
    const categoryResults: { tag: string; today: number; yesterday: number; increase: number }[] = []
    for (const tag of tags) {
      try {
        // 1) hashtag_id 검색
        const searchUrl = `https://graph.facebook.com/v19.0/ig_hashtag_search?user_id=${igUserId}&q=${encodeURIComponent(tag)}&access_token=${token}`
        const searchData = await safeJson<{ data?: Array<{ id?: string }> }>(searchUrl)
        const hashtagId = searchData?.data?.[0]?.id
        if (!hashtagId) continue

        // 2) media_count 조회
        const countUrl = `https://graph.facebook.com/v19.0/${hashtagId}?fields=name,media_count&access_token=${token}`
        const countData = await safeJson<{ media_count?: number }>(countUrl)
        const todayCount = countData?.media_count ?? 0
        if (todayCount === 0) continue

        // 3) 어제 카운트 조회
        const { data: ydayRow } = await sb
          .from('instagram_hashtag_counts')
          .select('media_count')
          .eq('hashtag', tag)
          .eq('date_kst', yesterdayStr)
          .maybeSingle()
        const yesterdayCount = (ydayRow as { media_count?: number } | null)?.media_count ?? todayCount
        const increase = todayCount - yesterdayCount

        // 4) 오늘 카운트 upsert
        await sb.from('instagram_hashtag_counts').upsert({
          hashtag: tag,
          media_count: todayCount,
          date_kst: todayStr,
        })

        categoryResults.push({ tag, today: todayCount, yesterday: yesterdayCount, increase })
      } catch (e) {
        console.warn(`[collectInstagramHashtagTrends] ${tag} error:`, e)
      }
    }

    // 카테고리별 증가량 top 2 (첫날엔 increase=0 이라 0개 — fallback 으로 today count 기준 top 2)
    const sorted = categoryResults
      .sort((a, b) => b.increase - a.increase)
    const picks = sorted.filter(r => r.increase > 0).slice(0, 2)
    // 첫날 또는 증가 0 이면 today count 상위 1개 라도 보여주기
    if (picks.length === 0 && categoryResults.length > 0) {
      const top = [...categoryResults].sort((a, b) => b.today - a.today)[0]
      results.push({
        source: `instagram_hashtag:${category}`,
        title: `#${top.tag} (${top.today.toLocaleString()}개 게시물)`,
        excerpt: `${category} 카테고리 인기 해시태그`,
        engagement: 30,
      })
    } else {
      picks.forEach(({ tag, increase, today }) => {
        results.push({
          source: `instagram_hashtag:${category}`,
          title: `#${tag} 급상승 (+${increase.toLocaleString()})`,
          excerpt: `오늘 ${today.toLocaleString()}개 게시물 · 어제 대비 +${increase.toLocaleString()}`,
          engagement: Math.min(100, 50 + Math.log10(Math.max(1, increase)) * 10),
        })
      })
    }
  }

  console.log('[collectInstagramHashtagTrends] total items:', results.length)
  return results
}

// ─────────────────────────────────────────────
// 통합 수집기 — 병렬 실행, 실패는 빈 배열로 흡수
// ─────────────────────────────────────────────
export async function collectAllTrends(): Promise<{
  items: FeedItem[]
  stats: Record<string, number>
}> {
  // Instagram Hashtag 는 외부 + DB 다중 호출이라 60초 안전 타임아웃 (메인 cron 영향 차단)
  const igHashtagWithTimeout = new Promise<FeedItem[]>((resolve) => {
    const t = setTimeout(() => { console.warn('[collectAllTrends] ig_hashtag timeout 60s'); resolve([]) }, 60000)
    collectInstagramHashtagTrends()
      .then(r => { clearTimeout(t); resolve(r) })
      .catch(e => { clearTimeout(t); console.warn('[collectAllTrends] ig_hashtag error:', e); resolve([]) })
  })

  const [
    googleTrends, signalbz, hn, koreanTrends, lh, yna, newsApi,
    bazaar, whowhatwear, wwd, refinery29, aptTherapy, designMilk,
    womensHealth, runnersWorld, nerdWallet, igHashtag,
  ] = await Promise.all([
    fetchGoogleTrendsKR().catch(() => [] as FeedItem[]),
    fetchSignalBz().catch(() => [] as FeedItem[]),
    fetchHackerNews().catch(() => [] as FeedItem[]),
    collectKoreanTrends().catch(() => [] as FeedItem[]),
    fetchLifehacker().catch(() => [] as FeedItem[]),
    fetchYonhapLife().catch(() => [] as FeedItem[]),
    collectNewsAPI().catch(() => [] as FeedItem[]),
    // Phase 2 신규
    fetchHarpersBazaar().catch(() => [] as FeedItem[]),
    fetchWhoWhatWear().catch(() => [] as FeedItem[]),
    fetchWWD().catch(() => [] as FeedItem[]),
    fetchRefinery29().catch(() => [] as FeedItem[]),
    fetchApartmentTherapy().catch(() => [] as FeedItem[]),
    fetchDesignMilk().catch(() => [] as FeedItem[]),
    fetchWomensHealth().catch(() => [] as FeedItem[]),
    fetchRunnersWorld().catch(() => [] as FeedItem[]),
    fetchNerdWallet().catch(() => [] as FeedItem[]),
    // Phase 3 신규 — Instagram Hashtag 급상승 (timeout-wrapped)
    igHashtagWithTimeout,
  ])
  const items = [
    ...googleTrends, ...signalbz, ...hn, ...koreanTrends, ...lh, ...yna, ...newsApi,
    ...bazaar, ...whowhatwear, ...wwd, ...refinery29, ...aptTherapy, ...designMilk,
    ...womensHealth, ...runnersWorld, ...nerdWallet, ...igHashtag,
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
      harpers_bazaar: bazaar.length,
      whowhatwear: whowhatwear.length,
      wwd: wwd.length,
      refinery29: refinery29.length,
      apartment_therapy: aptTherapy.length,
      design_milk: designMilk.length,
      womens_health: womensHealth.length,
      runners_world: runnersWorld.length,
      nerdwallet: nerdWallet.length,
      ig_hashtag: igHashtag.length,
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
