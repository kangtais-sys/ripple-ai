// POST /api/trends/more
// 같은 카테고리 안에서 추가 주제 N개 실시간 생성 (mirra 스타일).
// daily_trends 풀이 소진됐을 때 호출 → Claude haiku 가 카테고리 + 제외 토픽 보고 새 10개 뽑음.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const CATEGORY_LABEL: Record<string, string> = {
  beauty: '뷰티', fashion: '패션', food: '음식', cafe: '카페',
  travel: '여행', interior: '인테리어', fitness: '운동', money: '재테크',
  book: '독서', baby: '육아', pet: '반려동물', kpop: 'K팝',
  movie: '영화', music: '음악', psych: '심리', mystery: '미스터리',
  life: '라이프', trend: '트렌드',
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

  const prompt = `너는 한국 SNS 카드뉴스 큐레이터다.
"${label}" 카테고리에서 지금 막 SNS·블로그·커뮤니티에서 회자될 만한 주제 ${count}개를 만들어줘.

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

🚫 시점 매핑 룰: 옛날 사실(2024년 이전)을 "지금" 으로 매핑하지 말 것. 학습 지식만 있으면 "최근 1~2년" 같은 모호한 표현 사용.

JSON 배열로만 응답. 다른 텍스트 X.

[
  { "topic": "...", "preview_hook": "...", "body_preview": "...", "why": "..." },
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
    const topics = JSON.parse(match[0]) as Array<Record<string, string>>
    const cleaned = topics
      .filter(t => t && typeof t.topic === 'string' && t.topic.length > 3)
      .map(t => ({
        topic: t.topic,
        preview_hook: t.preview_hook || '',
        body_preview: t.body_preview || '',
        why: t.why || '',
        category,
      }))
    return NextResponse.json({ ok: true, topics: cleaned, category })
  } catch (e) {
    return NextResponse.json({ ok: false, reason: 'exception', detail: String(e), topics: [] })
  }
}
