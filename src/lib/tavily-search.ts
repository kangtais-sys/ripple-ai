// Tavily Search API 통합 (mirra.my 스타일 실시간 검색)
//   1) generateSearchQueries — Claude haiku 가 사용자 주제+컨텍스트 → 검색 쿼리 4개 (한국어 + site:filter + SNS)
//   2) tavilySearch — Tavily API 호출 (include_domains 활용)
//   3) buildTavilySearchBlock — 검색 결과를 [실시간 검색 결과] 블록으로 정리해 generate prompt 에 prepend
//
// 환경변수:
//   TAVILY_API_KEY — https://tavily.com (무료 1000회/월)
//   ANTHROPIC_API_KEY — 쿼리 생성 (Claude haiku)

export type TavilyResult = {
  title: string
  url: string
  content: string                // snippet
  score?: number
  published_date?: string
}

// 카테고리별 한국 특화 도메인 (mirra.my 패턴 참고)
//   카드뉴스 본문에 한국 SNS·블로그·미디어 인용 → K-MZ 톤 강화
const KOREAN_DOMAINS_BY_CATEGORY: Record<string, string[]> = {
  beauty_treatment:  ['brunch.co.kr', 'glowpick.com', 'blog.naver.com', 'health.chosun.com'],
  beauty_product:    ['brunch.co.kr', 'glowpick.com', 'blog.naver.com', 'oliveyoung.co.kr'],
  beauty_ingredient: ['brunch.co.kr', 'glowpick.com', 'blog.naver.com'],
  beauty_trouble:    ['brunch.co.kr', 'glowpick.com', 'blog.naver.com', 'health.chosun.com'],
  cafe:              ['brunch.co.kr', 'blog.naver.com', 'instagram.com', 'tiktok.com'],
  food:              ['brunch.co.kr', 'blog.naver.com', 'mangoplate.com', 'instagram.com'],
  fashion:           ['brunch.co.kr', 'musinsa.com', 'blog.naver.com', 'instagram.com'],
  travel_domestic:   ['brunch.co.kr', 'blog.naver.com', 'tripadvisor.co.kr', 'instagram.com'],
  travel_abroad:     ['brunch.co.kr', 'tripadvisor.co.kr', 'instagram.com', 'tiktok.com'],
  interior:          ['brunch.co.kr', 'blog.naver.com', 'oh-house.com', 'instagram.com'],
  fitness:           ['brunch.co.kr', 'blog.naver.com', 'tiktok.com', 'instagram.com'],
  money_tip:         ['brunch.co.kr', 'blog.naver.com', 'mt.co.kr', 'investopedia.com'],
  price_compare:     ['brunch.co.kr', 'blog.naver.com', 'danawa.com'],
  trend:             ['brunch.co.kr', 'instagram.com', 'tiktok.com', 'twitter.com'],
  review:            ['brunch.co.kr', 'blog.naver.com', 'glowpick.com'],
  life_tip:          ['brunch.co.kr', 'blog.naver.com', 'tiktok.com', 'instagram.com'],
  book:              ['brunch.co.kr', 'blog.naver.com', 'aladin.co.kr', 'yes24.com'],
  baby:              ['brunch.co.kr', 'blog.naver.com', 'instagram.com'],
  pet:               ['brunch.co.kr', 'blog.naver.com', 'instagram.com'],
  etc:               ['brunch.co.kr', 'blog.naver.com', 'instagram.com'],
}

// ─────────────────────────────────────────────
// 1) Tavily Search 호출
// ─────────────────────────────────────────────
export async function tavilySearch(query: string, args: {
  includeDomains?: string[]
  maxResults?: number
}): Promise<TavilyResult[]> {
  const key = process.env.TAVILY_API_KEY
  if (!key) {
    console.warn('[tavilySearch] missing TAVILY_API_KEY')
    return []
  }
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',     // basic = 1 credit, advanced = 2 credits
        include_domains: args.includeDomains,
        max_results: args.maxResults || 5,
        include_answer: false,
        include_raw_content: false,
      }),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.warn('[tavilySearch] error:', res.status, errBody.slice(0, 200))
      return []
    }
    const data = await res.json() as { results?: TavilyResult[] }
    return data.results || []
  } catch (e) {
    console.error('[tavilySearch] exception:', e)
    return []
  }
}

// ─────────────────────────────────────────────
// 2) Claude haiku 로 검색 쿼리 4개 생성
//   사용자 주제 + 카테고리 + 톤 → 검색 쿼리 (한국어 1 / site:filter 2 / SNS 1)
// ─────────────────────────────────────────────
export async function generateSearchQueries(args: {
  topic: string
  category: string
  contentTone?: string
}): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return []

  const koreanDomains = (KOREAN_DOMAINS_BY_CATEGORY[args.category] || KOREAN_DOMAINS_BY_CATEGORY.etc)
    .filter(d => !d.includes('instagram.com') && !d.includes('tiktok.com'))
    .slice(0, 3)

  const prompt = `너는 한국 SNS 카드뉴스 큐레이터다.
사용자가 입력한 주제를 가지고, Tavily 검색에 쓸 쿼리 4개를 만들어줘.

[입력]
주제: "${args.topic}"
카테고리: ${args.category}
톤: ${args.contentTone || 'friendly'}

[쿼리 룰]
- 한국어 자연어 검색어로 작성. 트렌드 시그널(올해/최근/시그니처) + 구체 키워드 포함.
- 1번: 일반 검색 (site: 없음)
- 2번: site:${koreanDomains[0] || 'brunch.co.kr'} 포함 (한국 콘텐츠 깊이)
- 3번: site:${koreanDomains[1] || 'blog.naver.com'} 포함 (한국 블로그)
- 4번: site:instagram.com OR site:tiktok.com (SNS 트렌드)

[좋은 쿼리 예시]
- "스타벅스 봄 신메뉴 라이트노트 솔직 후기 2026"
- "혼자 살이 진짜 사길 잘한 가전 site:brunch.co.kr"
- "30대 자취 인테리어 꿀팁 site:blog.naver.com"
- "올영 4월 세일 베스트 site:instagram.com"

[나쁜 쿼리]
- 너무 일반적: "건강한 식습관" → 좁혀서 "이너뷰티 식단 site:blog.naver.com 2026"
- 영어 위주: 한국어 우선
- site:filter 없이 너무 광범위

JSON 배열로만 응답. 다른 텍스트 X.

["쿼리1", "쿼리2", "쿼리3", "쿼리4"]`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      console.warn('[generateSearchQueries] claude error:', res.status)
      return []
    }
    const data = await res.json()
    const text = data.content?.[0]?.text || '[]'
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []
    const queries = JSON.parse(match[0]) as string[]
    return queries.filter(q => typeof q === 'string' && q.length > 5).slice(0, 4)
  } catch (e) {
    console.warn('[generateSearchQueries] exception:', e)
    return []
  }
}

// ─────────────────────────────────────────────
// 3) 통합 — 검색 쿼리 생성 → 병렬 검색 → 결과 dedupe → [실시간 검색 결과] 블록 반환
// ─────────────────────────────────────────────
export async function buildTavilySearchBlock(args: {
  topic: string
  category: string
  contentTone?: string
}): Promise<string> {
  const queries = await generateSearchQueries(args)
  console.log('[buildTavilySearchBlock] generated queries:', queries.length, queries.slice(0, 4))
  if (queries.length === 0) return ''

  // 병렬 검색 (각 쿼리 max 5 결과)
  const searchResults = await Promise.all(
    queries.map(q => tavilySearch(q, { maxResults: 5 }))
  )

  // 결과 합치기 + URL 중복 제거
  const seen = new Set<string>()
  type Item = { title: string; url: string; snippet: string; domain: string }
  const all: Item[] = []
  searchResults.forEach((results) => {
    results.forEach(r => {
      if (!r.url || seen.has(r.url)) return
      seen.add(r.url)
      let domain = ''
      try { domain = new URL(r.url).hostname.replace(/^www\./, '') } catch { domain = '' }
      all.push({
        title: (r.title || '').trim(),
        url: r.url,
        snippet: (r.content || '').slice(0, 250).trim(),
        domain,
      })
    })
  })
  console.log('[buildTavilySearchBlock] total deduped results:', all.length)
  if (all.length === 0) return ''

  // 도메인 다양성 보장 (한 도메인 최대 3개)
  const perDomain: Record<string, number> = {}
  const picked = all.filter(it => {
    const c = perDomain[it.domain] || 0
    if (c >= 3) return false
    perDomain[it.domain] = c + 1
    return true
  }).slice(0, 12)  // 총 최대 12개

  const lines = picked.map(p =>
    `- [${p.domain}] ${p.title}${p.snippet ? `\n  ${p.snippet}` : ''}`
  ).join('\n')

  return `

[실시간 검색 결과 — Tavily ${queries.length}개 쿼리, ${picked.length}개 결과]
${lines}

위 항목의 사실·이름·수치·시점을 본문에 그대로 인용. 출처 도메인은 짧게 표기 (예: "스벅 라이트노트 1주 만에 완판" — brunch.co.kr).
검색 결과에 없는 정보는 만들지 말 것. 비어 있으면 그 슬라이드는 다른 구체 정보로 채울 것.`
}
