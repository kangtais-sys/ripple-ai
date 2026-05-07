// 카테고리별 Claude 호출 — 단일 카테고리에 대해 5개 토픽 생성
//
// 이전 방식 (1번 호출로 90개 토픽) 의 문제:
//   - max_tokens 한계 자주 도달
//   - JSON 길어져서 파싱 오류 빈번
//   - Vercel 300s 안에서 불안정
//
// 신 방식 (카테고리당 1번 호출, 18번 병렬):
//   - 각 호출 ~500 토큰 출력 → max_tokens 1500 충분
//   - 작은 JSON → 파싱 안정
//   - 18 병렬 = 가장 느린 거 ~10초
//   - 한 카테고리 실패해도 다른 거 영향 0
//
// 입력: 카테고리 + Tavily 검색 결과 (해당 카테고리만)
// 출력: 5개 토픽 (topic, why, preview_hook, body_preview, hook_score, source)

import type { CategorySearchItem } from './category-tavily'

export type CategoryTopic = {
  topic: string
  why: string
  preview_hook: string
  body_preview: string
  hook_score: number
  source: string
}

const CATEGORY_LABEL: Record<string, string> = {
  beauty: '뷰티', fashion: '패션', food: '음식', cafe: '카페',
  travel: '여행', interior: '인테리어', fitness: '운동', money: '재테크',
  book: '독서', baby: '육아', pet: '반려동물', kpop: 'K팝',
  movie: '영화', music: '음악', psych: '심리', mystery: '미스터리',
  life: '라이프', trend: '트렌드',
}

function buildPrompt(cat: string, search: CategorySearchItem[]): string {
  const label = CATEGORY_LABEL[cat] || cat
  const ctx = search.slice(0, 8).map(s =>
    `[${s.domain}] ${s.title}${s.snippet ? ` :: ${s.snippet.slice(0, 120)}` : ''}`
  ).join('\n')

  return `너는 한국 SNS 카드뉴스 큐레이터다. "${label}" 카테고리에서 지금 회자되는 토픽 5개 생성.

## 실시간 검색 결과 (Tavily ${search.length}개)
${ctx || '(검색 결과 없음 — 학습 지식 기반)'}

## 출력 — JSON 배열만, 한국어, 다른 텍스트 절대 X

[{"topic":"후킹 15자 이내","why":"왜 지금 뜨는지 50자","preview_hook":"10자 짧은 후킹","body_preview":"60~80자 본문 미리보기 (구체 사실/이름/수치 포함)","hook_score":8,"source":"핵심 도메인 1개 또는 빈 문자열"},...5개]

## 룰
- topic = 후킹 6패턴 중 1개: 대비형/숫자+연도형/역추적형/비밀공개형/경험자증언형/순위리스트형
  · 단순 정보 나열 금지 ("스킨케어 방법 X" / "30대가 결국 정착한 토너 4개 O")
- 5개 모두 같은 카테고리 안에서 서브토픽 다양화 (제품/시술/트렌드/비교/후기/가성비/실패담/순위 골고루)
- body_preview 60~80자, 구체 브랜드·이름·수치 포함, 검색 결과 적극 인용
- source 는 검색 결과의 핵심 도메인 1개 (없으면 "")
- hook_score 7~10 (10 = 클릭 안 할 수 없음)
- 옛날 사실(2024 이전)을 "지금"으로 매핑 금지`
}

export async function generateCategoryTopics(
  cat: string,
  search: CategorySearchItem[]
): Promise<CategoryTopic[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return []

  const prompt = buildPrompt(cat, search)

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
        max_tokens: 1800,
        system: '너는 JSON-only API. 응답은 JSON 배열 한 개로만. 마크다운/설명/인사 모두 금지.',
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '[' },  // 배열 시작 강제
        ],
      }),
    })
    if (!res.ok) {
      console.warn(`[category-claude:${cat}] http ${res.status}`)
      return []
    }
    type ClaudeResp = { content?: Array<{ text?: string }> }
    const data = (await res.json()) as ClaudeResp
    const text = '[' + ((data.content?.[0]?.text) || '')

    // 파싱: 1차 그대로, 2차 [ ... ] 추출
    const tryParse = (s: string): CategoryTopic[] | null => {
      try {
        const j = JSON.parse(s) as Array<Record<string, unknown>>
        if (!Array.isArray(j)) return null
        return j
          .filter(t => t && typeof t.topic === 'string' && (t.topic as string).length > 3)
          .slice(0, 5)
          .map(t => ({
            topic: t.topic as string,
            why: (t.why as string) || '',
            preview_hook: (t.preview_hook as string) || '',
            body_preview: (t.body_preview as string) || '',
            hook_score: typeof t.hook_score === 'number' ? (t.hook_score as number) : 8,
            source: (t.source as string) || '',
          }))
      } catch { return null }
    }

    let topics = tryParse(text)
    if (!topics) {
      const m = text.match(/\[[\s\S]*\]/)
      if (m) topics = tryParse(m[0])
    }
    return topics || []
  } catch (e) {
    console.warn(`[category-claude:${cat}] error:`, e)
    return []
  }
}

// 모든 카테고리 병렬 실행 — 가장 느린 거에 맞춰서 끝남
export async function generateAllCategoryTopics(
  searchByCategory: Record<string, CategorySearchItem[]>
): Promise<Record<string, CategoryTopic[]>> {
  const cats = Object.keys(searchByCategory)
  const results = await Promise.all(
    cats.map(cat =>
      generateCategoryTopics(cat, searchByCategory[cat] || [])
        .then(topics => [cat, topics] as const)
        .catch(() => [cat, []] as const)
    )
  )
  return Object.fromEntries(results)
}
