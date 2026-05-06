// GET /api/cron/trend-research  (Vercel Cron · 매일 14:00 UTC = 23:00 KST)
//
// 2026-05 업데이트: Tavily 카테고리별 검색을 메인으로, 기존 RSS 17개는 fallback 보강.
//   1) collectAllTrends() — RSS 17개 + IG hashtag 풀 (engagement TOP 20)
//   2) searchAllCategories() — 카테고리당 3 query × 4 결과 (= 약 200개 풀, 도메인 다양)
//   3) Claude 에 두 풀 모두 전달 → recommended_topics 3개 + topics_by_category 18카×10개
//      각 토픽에 sources (도메인 배열 1~3개) 자동 첨부 → multi-source 카드 가능
//   4) daily_trends upsert (date_kst 기준)
//
// 비용:
//   Claude: 1회/일 (변동 없음, 프롬프트 약간 길어짐)
//   Tavily: 18 × 3 = 54 호출/일 → 무료 1,000/월 안에서 운영 (월 1,620 호출)
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { collectAllTrends, rankTopN } from '@/lib/trend-collectors'
import { searchAllCategories } from '@/lib/category-tavily'
import { TREND_RESEARCH_PROMPT } from '@/lib/cardnews-prompt'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  // Cron secret 검증 (Vercel cron 은 Authorization: Bearer CRON_SECRET 으로 호출)
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // KST 날짜 (검색 query 키워드 회전·시간 한정자 시드)
  const _now0 = new Date()
  const _kst0 = new Date(_now0.getTime() + (9 * 60 - _now0.getTimezoneOffset()) * 60 * 1000)
  const dateKst = _kst0.toISOString().slice(0, 10)

  // 1) 두 트랙 병렬 수집 — RSS pool + 카테고리별 Tavily
  const [rssResult, catSearchMap] = await Promise.all([
    collectAllTrends(),
    searchAllCategories(dateKst).catch(e => {
      console.warn('[cron] tavily category search failed:', e)
      return {} as Record<string, never>
    }),
  ])
  const { items, stats } = rssResult
  const top20 = rankTopN(items, 20)

  // 카테고리별 검색 풀 — Claude 에 직접 전달 (토픽 생성 시 직접 인용 + sources 추출)
  // 형태: { beauty: [{title, snippet, domain}, ...], fashion: [...], ... }
  const catSearchTrim: Record<string, Array<{ title: string; snippet: string; domain: string }>> = {}
  let catSearchTotal = 0
  Object.keys(catSearchMap).forEach(cat => {
    const items = (catSearchMap as Record<string, Array<{ title: string; snippet: string; domain: string }>>)[cat] || []
    catSearchTrim[cat] = items.slice(0, 12).map(it => ({
      title: it.title,
      snippet: it.snippet,
      domain: it.domain,
    }))
    catSearchTotal += catSearchTrim[cat].length
  })

  if (top20.length === 0 && catSearchTotal === 0) {
    return NextResponse.json({ ok: false, reason: 'no_feed_items', stats })
  }

  // 2) Claude 호출 — 두 풀 모두 던지고 카테고리당 10개 토픽 (multi-source)
  const userPrompt = `${TREND_RESEARCH_PROMPT}

## 입력 데이터 A (rawFeedItems · RSS·뉴스·IG hashtag pool)
${JSON.stringify(top20, null, 2)}

## 입력 데이터 B (카테고리별 Tavily 검색 결과 · 매일 회전 키워드)
${JSON.stringify(catSearchTrim, null, 2)}

## 출력 형식 (JSON 만, 다른 텍스트 X)
{
  "top5": [
    { "title": "...", "source": "...", "engagement": 80, "category": "...", "researchable": true, "hook_score": 9 }
  ],
  "recommended_topics": [
    { "topic": "후킹 문구 15자 이내", "category": "trend|beauty|fashion|food|cafe|travel|interior|fitness|money|book|baby|pet|kpop|movie|music|psych|mystery|life", "why": "왜 지금 뜨는지 한 줄", "preview_hook": "10자 이내 짧은 후킹", "body_preview": "카드뉴스 첫 슬라이드 본문 톤 2~3줄 (60~100자). 구체 사실/이름/수치 포함.", "sources": ["domain1", "domain2"] }
  ],
  "topics_by_category": {
    "beauty":   [{ "topic": "...", "why": "...", "preview_hook": "...", "body_preview": "2~3줄", "hook_score": 8, "sources": ["domain1", "domain2"] }, ...10개],
    "fashion":  [...10개],
    "food":     [...10개],
    "cafe":     [...10개],
    "travel":   [...10개],
    "interior": [...10개],
    "fitness":  [...10개],
    "money":    [...10개],
    "book":     [...10개],
    "baby":     [...10개],
    "pet":      [...10개],
    "kpop":     [...10개],
    "movie":    [...10개],
    "music":    [...10개],
    "psych":    [...10개],
    "mystery":  [...10개],
    "life":     [...10개],
    "trend":    [...10개]
  }
}

룰:
- recommended_topics 3개: 카테고리 무관 오늘 가장 핫한 주제. hook_score 9~10 만.
- topics_by_category: 18개 카테고리 각 정확히 **10개**. 같은 카테고리 안에서도 서브토픽 다양하게 (제품 / 시술 / 트렌드 / 비교 / 후기 / 가성비 / 실패담 / 순위 골고루). 입력 데이터 B 의 카테고리별 검색 결과를 우선 활용, 부족하면 입력 데이터 A 와 모델 일반 지식으로 보강.
- **hook_score (1~10)**: 토픽 후킹 강도 (10 = 클릭 안 할 수 없음 / 7 = 평균 / 5 이하는 만들지 말 것). 모든 토픽 7 이상.
- **sources (배열, 1~3개)**: 그 토픽이 어디서 나온 정보인지 도메인 배열 — 입력 데이터 B 에서 활용한 도메인 우선 (예: ["vogue.com", "reddit.com"]). 입력 데이터에 해당 카테고리 정보 없으면 ["일반"] 하나.
- topic 은 항상 한국어 자연어. 영문 제목은 한국 SNS 톤으로 의역.
- **topic 은 후킹 6패턴 중 1개 적용**: 대비형 / 숫자+연도형 / 역추적형 / 비밀공개형 / 경험자 증언형 / 순위 리스트형
  · 단순 정보 나열 금지: "스킨케어 방법 소개" X / "30대가 결국 정착한 토너 4개" O
  · 주제어만 나열 금지: "뷰티 트렌드" X / "다이소 화장솜으로 만드는 에르메스급 피부결" O
- why 한 줄 (왜 지금 뜨는지 · 50자 이내)
- preview_hook 10자 이내, 카드뉴스 첫 슬라이드 후킹 자체로 사용 가능
- **body_preview 60~100자, 2~3줄 본문 미리보기** — 카드 클릭 전에 어떤 내용인지 확 보여주는 부분. 구체 브랜드/이름/수치 포함. SNS 자연체. 입력 데이터 B 의 snippet 적극 인용.
  · 좋은 예: "스타벅스 봄 한정 라이트노트, 출시 7일 만에 완판. 컴포즈·메가커피도 비슷한 라떼 출시 임박. 이번 주말이 마지막 기회."
  · 나쁜 예: "스타벅스 봄 신메뉴가 화제입니다." (정보 없음, 형식적)

🚫 **시점 매핑 룰 (중요)**: 너의 학습 데이터는 특정 시점에 멈춰있어. 옛날 사실(2024년 이전)을 "지금" 또는 "최근" 으로 매핑하지 말 것.
  · 입력 데이터 A·B 에 시점 정보가 명확하면 그대로 인용
  · 학습 지식만 있으면 "최근 1~2년" 같은 모호한 표현 사용 (특정 연도 박지 말 것)
  · "올해" 같은 표현은 입력 데이터가 그것을 뒷받침할 때만 사용
  · 옛 사실을 "지금" 처럼 포장하면 즉시 재작성
`

  // ─── Claude API 호출 — 견고한 버전 ───────────────────────────────
  //   1) system 프롬프트로 JSON-only 강제
  //   2) assistant 프리필 `{` 로 JSON 시작 보장
  //   3) HTTP status 검증
  //   4) JSON 파싱 실패 시 1회 재시도 (max_tokens 높여서)
  //   5) 파싱 결과 누락 시 상세 로그 + 파싱 시도 수정
  //   6) topics_by_category 비어있으면 명시적 에러로 처리 (silent fail 방지)
  type ClaudeResp = { content?: Array<{ text?: string }>; usage?: Record<string, unknown>; stop_reason?: string; error?: { message?: string } }
  type ParsedResp = {
    top5?: Array<Record<string, unknown>>
    recommended_topics?: Array<Record<string, unknown>>
    topics_by_category?: Record<string, Array<Record<string, unknown>>>
  }
  let claudeResp: ClaudeResp = {}
  let parsed: ParsedResp = {}
  let claudeRawText = ''
  let lastError = ''

  async function callClaude(maxTokens: number): Promise<{ ok: boolean; resp?: ClaudeResp; text?: string; err?: string; status?: number }> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: maxTokens,
          system: '너는 JSON-only API 다. 응답은 반드시 valid JSON 객체 하나로만. 마크다운 코드블록 (```), 설명, 인사말, 그 어떤 prefix/suffix 도 절대 금지. 첫 글자 { 로 시작해서 마지막 글자 } 로 끝나는 단일 JSON.',
          messages: [
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: '{' },  // 프리필: JSON 시작 강제
          ],
        }),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        return { ok: false, err: 'http_' + res.status + ': ' + errText.slice(0, 300), status: res.status }
      }
      const j = (await res.json()) as ClaudeResp
      // 프리필 `{` 추가 → 응답에서 첫 `{` 가 빠져있을 것 → 다시 붙임
      const text = '{' + ((j.content?.[0]?.text) || '')
      return { ok: true, resp: j, text }
    } catch (e) {
      return { ok: false, err: 'exception: ' + String(e) }
    }
  }

  function tryParseJSON(text: string): { ok: boolean; data?: ParsedResp; err?: string } {
    if (!text) return { ok: false, err: 'empty' }
    // 1차: 전체 텍스트 그대로 파싱
    try { return { ok: true, data: JSON.parse(text) as ParsedResp } } catch {}
    // 2차: { ... } 가장 큰 블록 추출
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try { return { ok: true, data: JSON.parse(match[0]) as ParsedResp } } catch (e) { return { ok: false, err: 'parse_outer: ' + String(e) } }
    }
    return { ok: false, err: 'no_json_found' }
  }

  // ─── 1차 시도 ───
  const attempt = await callClaude(20000)
  if (attempt.ok && attempt.text) {
    claudeResp = attempt.resp || {}
    claudeRawText = attempt.text
    const p = tryParseJSON(attempt.text)
    if (p.ok && p.data) parsed = p.data
    else lastError = p.err || 'parse_unknown'
  } else {
    lastError = attempt.err || 'unknown'
  }

  // ─── 1차 실패 또는 topics_by_category 비었으면 재시도 (max_tokens 늘려서) ───
  const hasValidTopics = parsed.topics_by_category && Object.keys(parsed.topics_by_category).length > 0
  if (!hasValidTopics) {
    console.warn('[cron] 1차 시도 실패 또는 topics_by_category 비어있음. 재시도. lastError:', lastError, 'rawText 길이:', claudeRawText.length, 'sample:', claudeRawText.slice(0, 500))
    const retry = await callClaude(28000)  // max_tokens 늘림
    if (retry.ok && retry.text) {
      claudeResp = retry.resp || claudeResp
      claudeRawText = retry.text
      const p = tryParseJSON(retry.text)
      if (p.ok && p.data) parsed = p.data
      else lastError = (p.err || 'parse_unknown') + ' (retry)'
    } else {
      lastError = (retry.err || 'unknown') + ' (retry)'
    }
  }

  // ─── 최종 검증: topics_by_category 비어있으면 silent fail 차단 ───
  const finalHasTopics = parsed.topics_by_category && Object.keys(parsed.topics_by_category).length > 0
  if (!finalHasTopics) {
    return NextResponse.json({
      ok: false,
      reason: 'parse_failed_or_empty',
      detail: lastError,
      stats,
      claudeStopReason: claudeResp.stop_reason || null,
      claudeUsage: claudeResp.usage || null,
      rawSample: claudeRawText.slice(0, 800),
    }, { status: 200 })
  }

  // 3) KST 날짜 — 위에서 이미 계산함 (dateKst 재사용)

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
        model: 'claude-sonnet-4-5-20250929',
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
