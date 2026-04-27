// POST /api/trends/more
// 같은 카테고리 안에서 추가 주제 N개 실시간 생성 (mirra 스타일).
//   1) 카테고리별 한국어 검색 쿼리 4개로 Tavily 병렬 검색
//   2) 검색 결과 (제목 + snippet) 를 haiku 한테 던져서 토픽 10개 생성
//   → 학습 지식만 쓰는 거 아니라 실제 "지금 이 시각" 뉴스/블로그/SNS 시그널 반영
import { NextRequest, NextResponse } from 'next/server'
import { tavilySearch } from '@/lib/tavily-search'

export const runtime = 'nodejs'
export const maxDuration = 60

const CATEGORY_LABEL: Record<string, string> = {
  beauty: '뷰티', fashion: '패션', food: '음식', cafe: '카페',
  travel: '여행', interior: '인테리어', fitness: '운동', money: '재테크',
  book: '독서', baby: '육아', pet: '반려동물', kpop: 'K팝',
  movie: '영화', music: '음악', psych: '심리', mystery: '미스터리',
  life: '라이프', trend: '트렌드',
}

// 카테고리별 한국 사이트 (Tavily site:filter 용)
const KOREAN_DOMAINS: Record<string, string[]> = {
  beauty:   ['glowpick.com', 'brunch.co.kr', 'blog.naver.com'],
  fashion:  ['musinsa.com', 'brunch.co.kr', 'blog.naver.com'],
  food:     ['mangoplate.com', 'brunch.co.kr', 'blog.naver.com'],
  cafe:     ['brunch.co.kr', 'blog.naver.com', 'instagram.com'],
  travel:   ['tripadvisor.co.kr', 'brunch.co.kr', 'blog.naver.com'],
  interior: ['oh-house.com', 'brunch.co.kr', 'blog.naver.com'],
  fitness:  ['brunch.co.kr', 'blog.naver.com', 'tiktok.com'],
  money:    ['mt.co.kr', 'brunch.co.kr', 'blog.naver.com'],
  book:     ['aladin.co.kr', 'yes24.com', 'brunch.co.kr'],
  baby:     ['brunch.co.kr', 'blog.naver.com', 'instagram.com'],
  pet:      ['brunch.co.kr', 'blog.naver.com', 'instagram.com'],
  kpop:     ['brunch.co.kr', 'twitter.com', 'instagram.com'],
  movie:    ['brunch.co.kr', 'blog.naver.com', 'twitter.com'],
  music:    ['brunch.co.kr', 'blog.naver.com', 'twitter.com'],
  psych:    ['brunch.co.kr', 'blog.naver.com'],
  mystery:  ['brunch.co.kr', 'blog.naver.com'],
  life:     ['brunch.co.kr', 'blog.naver.com', 'tiktok.com'],
  trend:    ['brunch.co.kr', 'instagram.com', 'twitter.com'],
}

// 카테고리별 검색 쿼리 시드 (트렌드 시그널 + 카테고리 키워드)
function buildSearchQueries(category: string, label: string): string[] {
  const domains = KOREAN_DOMAINS[category] || ['brunch.co.kr', 'blog.naver.com']
  return [
    `${label} 요즘 핫한 2026`,
    `${label} 솔직 후기 site:${domains[0] || 'brunch.co.kr'}`,
    `${label} 추천 베스트 site:${domains[1] || 'blog.naver.com'}`,
    `${label} 실패 후기 OR 비교 OR 가성비`,
  ]
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ ok: false, reason: 'no_api_key', topics: [] })

  const body = await req.json().catch(() => ({})) as {
    category?: string
    exclude?: string[]
    count?: number
  }
  const category = body.category || 'trend'
  const exclude = Array.isArray(body.exclude) ? body.exclude.slice(0, 60) : []
  const count = Math.min(Math.max(body.count || 10, 3), 15)
  const label = CATEGORY_LABEL[category] || category

  // 1) Tavily 병렬 검색 (4쿼리 × max 4결과 = 최대 16개)
  const queries = buildSearchQueries(category, label)
  const searchResults = await Promise.all(
    queries.map(q => tavilySearch(q, { maxResults: 4 }))
  )

  // 결과 합치기 + URL 중복 제거 + 도메인 다양성 (한 도메인 최대 3개)
  const seenUrl = new Set<string>()
  const perDomain: Record<string, number> = {}
  type Item = { title: string; snippet: string; domain: string }
  const items: Item[] = []
  searchResults.forEach(arr => {
    arr.forEach(r => {
      if (!r.url || seenUrl.has(r.url)) return
      seenUrl.add(r.url)
      let domain = ''
      try { domain = new URL(r.url).hostname.replace(/^www\./, '') } catch { domain = '' }
      const c = perDomain[domain] || 0
      if (c >= 3) return
      perDomain[domain] = c + 1
      items.push({
        title: (r.title || '').trim(),
        snippet: (r.content || '').slice(0, 200).trim(),
        domain,
      })
    })
  })
  const searchBlock = items.length > 0
    ? items.slice(0, 12).map(p => `- [${p.domain}] ${p.title}${p.snippet ? `\n  ${p.snippet}` : ''}`).join('\n')
    : '(검색 결과 없음 — 학습 지식 기반으로 생성)'

  // 2) Haiku 에 검색 결과 던지고 토픽 10개 생성
  const prompt = `너는 한국 SNS 카드뉴스 큐레이터다.
"${label}" 카테고리에서 지금 막 SNS·블로그·커뮤니티에서 회자될 만한 주제 ${count}개를 만들어줘.

[실시간 검색 결과 — Tavily ${queries.length}개 쿼리, ${items.length}개 결과]
${searchBlock}

위 검색 결과의 사실·이름·수치·시점을 적극 인용해서 topic 과 body_preview 작성. 검색에 안 나온 정보는 만들지 말 것.

[제외 — 이미 사용자에게 보여진 토픽이라 절대 중복 X]
${exclude.length > 0 ? exclude.map(t => `- ${t}`).join('\n') : '(없음)'}

[룰]
- topic 은 후킹 6패턴 중 1개 적용:
  · 대비형 / 숫자+연도형 / 역추적형 / 비밀공개형 / 경험자 증언형 / 순위 리스트형
  · 단순 정보 나열 금지: "스킨케어 방법" X / "30대가 결국 정착한 토너 4개" O
  · 주제어만 나열 금지: "뷰티 트렌드" X / "다이소 화장솜으로 만드는 에르메스급 피부결" O
- ${label} 카테고리 안에서 서브토픽 다양하게 (제품 / 시술 / 트렌드 / 비교 / 후기 / 가성비 / 실패담 / 순위 / 인물 / 노하우 골고루)
- 한국어 자연어. 영문 제목은 한국 SNS 톤으로 의역
- preview_hook 10자 이내, 카드 첫 슬라이드 후킹
- body_preview 60~100자, 2~3줄. 구체 브랜드/이름/수치 포함. SNS 자연체. 카드 클릭 전에 어떤 내용인지 확 보여주는 부분
  · 좋은 예: "스타벅스 봄 한정 라이트노트, 출시 7일 만에 완판. 컴포즈·메가커피도 비슷한 라떼 출시 임박. 이번 주말이 마지막 기회."
  · 나쁜 예: "스타벅스 봄 신메뉴가 화제입니다." (정보 없음)

🚫 시점 매핑 룰: 검색 결과에 시점 정보가 명확하면 그대로 인용. 검색에 시점 없고 학습 지식만 있으면 "최근 1~2년" 같은 모호한 표현. 옛날 사실(2024년 이전)을 "지금" 으로 매핑 금지.

- **hook_score (7~10)**: SNS 카드 후킹 강도. 10 = 클릭 안 할 수 없음, 7 = 평균. 6패턴 강도 + 시점 신선도 + 정보 구체성 종합.
- **source**: 위 검색 결과 중 가장 핵심 인용한 출처 도메인 1개 (예: "보그 코리아", "glowpick"). 없으면 빈 문자열.

JSON 배열로만 응답. 다른 텍스트 X.

[
  { "topic": "...", "preview_hook": "...", "body_preview": "...", "why": "...", "hook_score": 9, "source": "..." },
  ...${count}개
]`

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
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return NextResponse.json({ ok: false, reason: 'claude_error', detail: errText.slice(0, 200), topics: [] })
    }
    const data = await res.json() as { content?: Array<{ text?: string }> }
    const text = data.content?.[0]?.text || '[]'
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return NextResponse.json({ ok: false, reason: 'parse_error', topics: [] })
    const topics = JSON.parse(match[0]) as Array<Record<string, unknown>>
    const cleaned = topics
      .filter(t => t && typeof t.topic === 'string' && (t.topic as string).length > 3)
      .map(t => ({
        topic: t.topic as string,
        preview_hook: (t.preview_hook as string) || '',
        body_preview: (t.body_preview as string) || '',
        why: (t.why as string) || '',
        hook_score: typeof t.hook_score === 'number' ? (t.hook_score as number) : 8,
        source: (t.source as string) || '',
        category,
      }))
    return NextResponse.json({
      ok: true,
      topics: cleaned,
      category,
      tavily_count: items.length,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, reason: 'exception', detail: String(e), topics: [] })
  }
}
