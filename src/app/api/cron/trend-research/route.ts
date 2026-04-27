// GET /api/cron/trend-research  (Vercel Cron · 매일 23:00 KST = 14:00 UTC)
// 1) Reddit + 올리브영 + 무신사 수집
// 2) engagement 내림차순 TOP 20 만 Claude 에 전달 (토큰 절약)
// 3) Claude (TREND_RESEARCH_PROMPT) → top5 + recommended_topics 3개
// 4) daily_trends upsert (date_kst 기준)
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { collectAllTrends, rankTopN } from '@/lib/trend-collectors'
import { TREND_RESEARCH_PROMPT } from '@/lib/cardnews-prompt'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  // Cron secret 검증 (Vercel cron 은 Authorization: Bearer CRON_SECRET 으로 호출)
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 1) 수집
  const { items, stats } = await collectAllTrends()
  const top20 = rankTopN(items, 20)

  if (top20.length === 0) {
    return NextResponse.json({ ok: false, reason: 'no_feed_items', stats })
  }

  // 2) Claude 호출 — 카테고리별 풀 + 통합 recommended 둘 다 요청
  const userPrompt = `${TREND_RESEARCH_PROMPT}

## 입력 데이터 (rawFeedItems)
${JSON.stringify(top20, null, 2)}

## 출력 형식 (JSON 만, 다른 텍스트 X)
{
  "top5": [
    { "title": "...", "source": "...", "engagement": 80, "category": "...", "researchable": true, "hook_score": 9 }
  ],
  "recommended_topics": [
    { "topic": "후킹 문구 15자 이내", "category": "trend|beauty|fashion|food|cafe|travel|interior|fitness|money|book|baby|pet|kpop|movie|music|psych|mystery|life", "why": "왜 지금 뜨는지 한 줄", "preview_hook": "10자 이내 짧은 후킹", "body_preview": "카드뉴스 첫 슬라이드 본문 톤으로 2~3줄 (60~100자). 구체 사실/이름/수치 포함. 사용자가 카드 클릭 전에 어떤 내용인지 확 들어오게." }
  ],
  "topics_by_category": {
    "beauty":   [{ "topic": "...", "why": "...", "preview_hook": "...", "body_preview": "2~3줄" }, ...5개],
    "fashion":  [...5개],
    "food":     [...5개],
    "cafe":     [...5개],
    "travel":   [...5개],
    "interior": [...5개],
    "fitness":  [...5개],
    "money":    [...5개],
    "book":     [...5개],
    "baby":     [...5개],
    "pet":      [...5개],
    "kpop":     [...5개],
    "movie":    [...5개],
    "music":    [...5개],
    "psych":    [...5개],
    "mystery":  [...5개],
    "life":     [...5개],
    "trend":    [...5개]
  }
}

룰:
- recommended_topics 3개: 카테고리 무관 오늘 가장 핫한 주제. hook_score 9~10 만.
- topics_by_category: 18개 카테고리 각 정확히 5개. 같은 카테고리 안에서도 서브토픽 다양하게 (제품 / 시술 / 트렌드 / 비교 / 후기 / 가성비 / 실패담 / 순위 등 골고루). 입력 데이터에 해당 카테고리 정보가 약하면 모델 일반 지식으로 보강해 작성. (5개로 baseline 만 만들고, 사용자가 더 보고 싶어하면 클라가 /api/trends/more 로 추가 생성함)
- topic 은 항상 한국어 자연어. 영문 제목은 한국 SNS 톤으로 의역.
- **topic 은 후킹 6패턴 중 1개 적용**: 대비형 / 숫자+연도형 / 역추적형 / 비밀공개형 / 경험자 증언형 / 순위 리스트형
  · 단순 정보 나열 금지: "스킨케어 방법 소개" X / "30대가 결국 정착한 토너 4개" O
  · 주제어만 나열 금지: "뷰티 트렌드" X / "다이소 화장솜으로 만드는 에르메스급 피부결" O
- why 한 줄 (왜 지금 뜨는지 · 50자 이내)
- preview_hook 10자 이내, 카드뉴스 첫 슬라이드 후킹 자체로 사용 가능
- **body_preview 60~100자, 2~3줄 본문 미리보기** — 카드 클릭 전에 어떤 내용인지 확 보여주는 부분. 구체 브랜드/이름/수치 포함. SNS 자연체.
  · 좋은 예: "스타벅스 봄 한정 라이트노트, 출시 7일 만에 완판. 컴포즈·메가커피도 비슷한 라떼 출시 임박. 이번 주말이 마지막 기회."
  · 나쁜 예: "스타벅스 봄 신메뉴가 화제입니다." (정보 없음, 형식적)

🚫 **시점 매핑 룰 (중요)**: 너의 학습 데이터는 특정 시점에 멈춰있어. 옛날 사실(2024년 이전)을 "지금" 또는 "최근" 으로 매핑하지 말 것.
  · 입력 데이터에 시점 정보가 명확하면 그대로 인용
  · 학습 지식만 있으면 "최근 1~2년" 같은 모호한 표현 사용 (특정 연도 박지 말 것)
  · "올해" 같은 표현은 입력 데이터가 그것을 뒷받침할 때만 사용
  · 옛 사실을 "지금" 처럼 포장하면 즉시 재작성
`

  let claudeResp: unknown = null
  let parsed: {
    top5?: Array<Record<string, unknown>>
    recommended_topics?: Array<Record<string, unknown>>
    topics_by_category?: Record<string, Array<Record<string, unknown>>>
  } = {}
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 20000,  // 18 카테고리 × 5개 × body_preview ≈ 15k 출력 토큰 (300s timeout 안에 맞춤)
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })
    claudeResp = await res.json()
    const text = (claudeResp as { content?: Array<{ text?: string }> })?.content?.[0]?.text || '{}'
    const match = text.match(/\{[\s\S]*\}/)
    if (match) parsed = JSON.parse(match[0])
  } catch (e) {
    return NextResponse.json({ ok: false, reason: 'claude_error', detail: String(e), stats })
  }

  // 3) KST 날짜 계산
  const now = new Date()
  const kstOffset = 9 * 60
  const kstNow = new Date(now.getTime() + (kstOffset - now.getTimezoneOffset()) * 60 * 1000)
  const dateKst = kstNow.toISOString().slice(0, 10)

  // 4) Supabase upsert
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { error } = await sb
    .from('daily_trends')
    .upsert({
      date_kst: dateKst,
      generated_at: new Date().toISOString(),
      top5: parsed.top5 || [],
      recommended_topics: parsed.recommended_topics || [],
      topics_by_category: parsed.topics_by_category || {},
      raw_feed_snapshot: top20,
      meta: {
        stats,
        usage: (claudeResp as { usage?: Record<string, unknown> })?.usage || null,
        model: 'claude-sonnet-4-20250514',
      },
    }, { onConflict: 'date_kst' })

  if (error) {
    return NextResponse.json({ ok: false, reason: 'db_error', detail: error.message, stats })
  }

  return NextResponse.json({
    ok: true,
    date_kst: dateKst,
    recommended_topics: parsed.recommended_topics || [],
    topics_by_category_keys: Object.keys(parsed.topics_by_category || {}),
    stats,
  })
}
