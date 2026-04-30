// POST /api/cardnews/generate
// body: { topic, slides?, template?, contentTone?, accountConcept?, researchData? }
// resp: { hook, body: [{title, text}...], caption, category, image_keywords, image_plan, job_id }
//
// 유저의 tone_profiles.learned_style 을 읽어 그 말투로 카드뉴스 생성.
// CONTENT_GENERATION_PROMPT 를 사용 (7장 기본, 후킹 점수 자체평가).
// 이미지 계획(planSlideImages)은 프론트가 Pinterest/올영/Gemini 라우팅에 쓸 정보.

import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { logAIUsage } from '@/lib/ai-usage'
import {
  buildContentGenerationPrompt,
  classifyCategory,
  planSlideImages,
  ensureCaption,
  scoreHook,
  scoreSavability,
  scoreViral,
  detectScope,
  recommendTemplates,
  type CategoryKey,
} from '@/lib/cardnews-prompt'
import { buildTavilySearchBlock } from '@/lib/tavily-search'
import { NextRequest, NextResponse } from 'next/server'

// daily_trends 항목 → 입력 주제와 관련된 실제 데이터 블록 생성 (Claude 본문에 인용용)
//   1) 주제·카테고리 토큰화
//   2) top5 + recommended_topics 의 title/excerpt 와 점수 매칭
//   3) 상위 6개 + 카테고리 일치 항목을 [실제 수집 데이터] 블록으로 반환
type DailyTrendsRow = {
  top5?: Array<{ title?: string; source?: string; category?: string; engagement?: number; researchable?: boolean; hook_score?: number }>
  recommended_topics?: Array<{ topic?: string; category?: string; why?: string; preview_hook?: string }>
  topics_by_category?: Record<string, Array<{ topic?: string; why?: string; preview_hook?: string }>>
}
// CategoryKey('beauty_treatment' 등) → topics_by_category 에서 사용한 단순 키('beauty' 등)로 매핑
function simplifyCategoryKey(cat: string): string {
  if (cat.startsWith('beauty')) return 'beauty'
  if (cat.startsWith('travel')) return 'travel'
  if (cat === 'food' || cat === 'cafe') return cat
  if (cat === 'money_tip' || cat === 'price_compare') return 'money'
  if (cat === 'life_tip') return 'life'
  if (cat === 'review') return 'trend'
  if (cat === 'fashion' || cat === 'interior' || cat === 'fitness'
      || cat === 'trend' || cat === 'book' || cat === 'baby' || cat === 'pet'
      || cat === 'kpop' || cat === 'movie' || cat === 'music' || cat === 'psych' || cat === 'mystery') return cat
  return 'trend'
}
const STOPWORDS = new Set([
  '이거', '저거', '그거', '하는', '되는', '있는', '없는', '같은', '어떤', '무슨', '몇', '진짜', '정말', '완전',
  '오늘', '어제', '내일', '올해', '이번', '지금', '요즘', '최근',
  '~', '·', '의', '에', '를', '을', '가', '이', '은', '는', '도', '만', '와', '과', '로',
  '가지', '개', '명', '번', 'top', 'best', 'vs', 'or', 'and',
])
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[가-힣a-z0-9]{2,}/g) || [])
    .filter(t => !STOPWORDS.has(t) && t.length >= 2)
}
function scoreItem(topicTokens: Set<string>, title: string, excerpt: string, category?: string, topicCategory?: string): number {
  let score = 0
  const titleTokens = tokenize(title)
  const excerptTokens = tokenize(excerpt)
  for (const t of titleTokens) if (topicTokens.has(t)) score += 2
  for (const t of excerptTokens) if (topicTokens.has(t)) score += 1
  if (topicCategory && category && (category === topicCategory || category.startsWith(topicCategory.split('_')[0]))) {
    score += 1.5  // 카테고리 일치 가산점
  }
  return score
}
async function buildCollectedDataBlock(sb: ReturnType<typeof adminClient>, topic: string, category: string): Promise<string> {
  try {
    // 최근 3일 daily_trends 조회 (오늘 데이터 없으면 어제까지 fallback)
    const { data: rows } = await sb
      .from('daily_trends')
      .select('top5, recommended_topics, topics_by_category, date_kst')
      .order('date_kst', { ascending: false })
      .limit(3)
    if (!rows || rows.length === 0) return ''
    const topicTokens = new Set(tokenize(topic))
    if (topicTokens.size === 0) return ''
    type Scored = { title: string; excerpt: string; source?: string; score: number }
    const candidates: Scored[] = []
    const simpleKey = simplifyCategoryKey(category)
    for (const row of rows as DailyTrendsRow[]) {
      // 1) topics_by_category[simpleKey] — 카테고리 정확 매칭 (가장 강한 신호)
      const catList = row.topics_by_category?.[simpleKey] || []
      for (const r of catList) {
        const title = r.topic || ''
        if (!title) continue
        candidates.push({
          title,
          excerpt: r.why || r.preview_hook || '',
          source: 'category',
          score: scoreItem(topicTokens, title, r.why || '', simpleKey, simpleKey) + 3,  // 카테고리 일치 보너스
        })
      }
      // 2) top5 — 글로벌 핫 트렌드 (점수 매칭)
      for (const t of (row.top5 || [])) {
        const title = t.title || ''
        if (!title) continue
        candidates.push({
          title,
          excerpt: '',
          source: t.source || 'trend',
          score: scoreItem(topicTokens, title, '', t.category, category),
        })
      }
      // 3) recommended_topics — 카테고리 무관 추천
      for (const r of (row.recommended_topics || [])) {
        const title = r.topic || ''
        if (!title) continue
        candidates.push({
          title,
          excerpt: r.why || r.preview_hook || '',
          source: 'recommended',
          score: scoreItem(topicTokens, title, r.why || '', r.category, category),
        })
      }
    }
    // 점수 > 0 + 상위 8개 + 중복 title 제거
    const seen = new Set<string>()
    const picks = candidates
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .filter(c => { if (seen.has(c.title)) return false; seen.add(c.title); return true })
      .slice(0, 8)
    if (picks.length === 0) return ''
    const lines = picks.map(p => `- [${p.source}] ${p.title}${p.excerpt ? ` — ${p.excerpt}` : ''}`).join('\n')
    return `

[실제 수집 데이터 — 최근 3일치 트렌드 항목 중 주제 "${topic}" (카테고리 ${simpleKey}) 와 매칭된 ${picks.length}개]
${lines}

위 항목의 사실·이름·수치·시점을 본문에 가능한 그대로 인용. 데이터에 없는 정보는 새로 만들지 말 것.`
  } catch {
    return ''
  }
}

// Claude haiku 로 카테고리 분류 (regex fallback). 약 200~400ms
async function classifyWithClaude(topic: string): Promise<CategoryKey> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 80,
        messages: [{
          role: 'user',
          content: `주제를 읽고 아래 18개 중 가장 적합한 카테고리 1개를 JSON 으로만 반환. 설명 없이 {"category": "..."} 형식만.

카테고리: beauty_treatment / beauty_product / beauty_ingredient / beauty_trouble / food / cafe / travel_domestic / travel_abroad / fashion / interior / fitness / money_tip / price_compare / trend / review / life_tip / book / etc

주제: "${topic}"`,
        }],
      }),
    })
    if (!res.ok) return classifyCategory(topic)
    const data = await res.json()
    const text = data.content?.[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return classifyCategory(topic)
    const parsed = JSON.parse(match[0]) as { category?: string }
    const valid: CategoryKey[] = ['beauty_treatment','beauty_product','beauty_ingredient','beauty_trouble','food','cafe','travel_domestic','travel_abroad','fashion','interior','fitness','money_tip','price_compare','trend','review','life_tip','book','etc']
    if (parsed.category && valid.includes(parsed.category as CategoryKey)) return parsed.category as CategoryKey
    return classifyCategory(topic)
  } catch {
    return classifyCategory(topic)
  }
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = adminClient()

  const body = await req.json().catch(() => ({})) as {
    topic?: string
    slides?: number
    template?: string
    contentTone?: 'warm' | 'friendly' | 'professional' | 'honest' | 'witty' | 'chic'
    accountConcept?: string
    researchData?: string
  }
  const topic = (body.topic || '').trim()
  if (!topic || topic.length < 3) {
    return NextResponse.json({ error: '주제를 3자 이상 입력해주세요' }, { status: 400 })
  }
  const slideCount = Math.min(Math.max(body.slides || 7, 3), 10)
  const contentTone = body.contentTone

  // 유저의 학습된 말투 + 브랜드 컨텍스트 불러오기
  const { data: tone } = await sb
    .from('tone_profiles')
    .select('learned_style, brand_context')
    .eq('user_id', user.id)
    .maybeSingle()
  const style = (tone?.learned_style as Record<string, unknown>) || {
    tone: '친근하고 솔직한',
    sentence_ending: '~했어, ~임, ~야',
    emoji_style: '적절히 (✨🌿😊)',
    length: '짧고 임팩트',
    characteristics: ['MZ 반말', '솔직 후기', '공감 유도'],
  }
  const accountConcept = body.accountConcept
    || (tone?.brand_context as string)
    || '한국 MZ 세대 SNS 크리에이터'

  // 카테고리: Claude 위임 (실패 시 regex fallback)
  const category = await classifyWithClaude(topic)
  // 스코프: 키워드 기반 (가벼움)
  const scope = detectScope(topic)
  // 추천 템플릿 (카테고리 자동 추천)
  const recommendedTemplates = recommendTemplates(category)

  // 스코프 힌트 — 리서치 데이터에 추가 (소스 라우팅 가이드)
  const scopeHint = scope === 'global'
    ? '\n[스코프 자동 판단: global] 외국 브랜드·도시·영문 키워드가 감지됨. 글로벌 정보 우선 사용.'
    : scope === 'kr'
    ? '\n[스코프 자동 판단: kr] 한국 브랜드·서비스·지명 중심.'
    : '\n[스코프 자동 판단: mixed] 한국·글로벌 양쪽 정보 활용.'

  // ─────────────────────────────────────────────
  // researchData 통합 — 3 소스 합쳐서 prepend (mirra.my 풍 알찬 본문)
  //   1) daily_trends 의 사전 수집 데이터 (cron 기반, 매일 23시 갱신)
  //   2) Tavily 실시간 검색 (쿼리 4개 병렬, 한국 도메인 우선) — 가장 신선
  //   3) scopeHint (KR/global)
  //   둘 다 병렬로 fetch → 어느 한쪽 실패해도 다른 쪽으로 보강
  // ─────────────────────────────────────────────
  const [collectedDataBlock, tavilyBlock] = await Promise.all([
    buildCollectedDataBlock(sb, topic, category),
    buildTavilySearchBlock({ topic, category, contentTone }).catch(e => {
      console.warn('[generate] tavily failed:', e)
      return ''
    }),
  ])
  const researchData = (body.researchData || '') + scopeHint + collectedDataBlock + tavilyBlock

  const prompt = buildContentGenerationPrompt({
    accountConcept,
    topic,
    researchData,
    slideCount,
    toneStyle: style,
    contentTone,
  })

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
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errTxt = await res.text()
      return NextResponse.json({ error: 'Claude API error', detail: errTxt }, { status: 502 })
    }

    const data = await res.json()
    const text = data.content?.[0]?.text || '{}'
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return NextResponse.json({ error: 'parse failed', raw: text }, { status: 502 })

    type ChecklistItem = { ok?: boolean; text?: string }
    type Entity = { type?: 'book' | 'product' | 'brand' | 'place'; name?: string; name_en?: string }
    type BodySlide = {
      role?: string
      title?: string
      text?: string
      narrative_bridge?: string  // 다음 슬라이드로 이어주는 한 줄
      list?: ChecklistItem[]     // role=checklist
      big_number?: string        // role=number
      sub?: string               // role=number
      items?: string[]           // role=toc
      entities?: Entity[]        // 실존 책·제품·브랜드·장소 — 이미지 자동 매칭용
    }
    type AltHook = { type?: 'number' | 'fomo' | 'reverse'; text?: string }
    type Parsed = {
      hook?: string
      cover_subtitle?: string
      alt_hooks?: AltHook[]
      hook_score?: number
      viral_score?: number
      savability_score?: number
      body?: BodySlide[]
      caption?: string
      category?: string
      image_keywords?: string[]
    }
    const parseJson = (txt: string): Parsed | null => {
      try { return JSON.parse(txt) as Parsed } catch { return null }
    }
    let parsed = parseJson(match[0])
    if (!parsed) {
      return NextResponse.json({ error: 'invalid JSON from Claude', raw: match[0] }, { status: 502 })
    }

    // 슬라이드 개수 검증 → 부족/초과 시 Claude 에게 1회 재요청
    const expected = slideCount - 1
    if (!Array.isArray(parsed.body) || parsed.body.length !== expected) {
      const retryPrompt = `${prompt}

━━━ 이전 응답의 body 배열 길이가 잘못됐어. ${parsed.body?.length || 0}개가 아니라 정확히 ${expected}개여야 해. 다시 만들어서 같은 JSON 형식으로만 출력해. 다른 말 금지.`
      const retry = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 8000,
          messages: [{ role: 'user', content: retryPrompt }],
        }),
      })
      if (retry.ok) {
        const retryData = await retry.json()
        const retryText = retryData.content?.[0]?.text || ''
        const retryMatch = retryText.match(/\{[\s\S]*\}/)
        if (retryMatch) {
          const retryParsed = parseJson(retryMatch[0])
          if (retryParsed && Array.isArray(retryParsed.body) && retryParsed.body.length === expected) {
            parsed = retryParsed
          }
        }
      }
    }

    // 재시도 후에도 개수 안 맞으면 마지막 보정 (조용히, error 문구 없이)
    if (Array.isArray(parsed.body)) {
      if (parsed.body.length > expected) {
        const kept = parsed.body.slice(0, expected - 1)
        const cta = parsed.body[parsed.body.length - 1]
        parsed.body = [...kept, cta]
      } else if (parsed.body.length < expected && parsed.body.length > 0) {
        const cta = parsed.body[parsed.body.length - 1]
        const middle = parsed.body.slice(0, -1)
        const pads = Array.from({ length: expected - parsed.body.length }, () => ({
          role: 'body',
          title: '핵심 한 줄',
          text: '핵심 포인트를 직접 채워보세요',
        }))
        parsed.body = [...middle, ...pads, cta]
      }
    }

    // 메타 라벨 자동 제거: AI 가 본문에 박는 "(참고용)/(검증 필요)/(주관적)..." 시스템성 라벨 차단
    //   괄호 안 키워드만 제거 — 비괄호 패턴은 본문 라인 통째 삭제 위험 있어 시스템 프롬프트로만 차단
    const metaRe = /\s*[\(（[【]\s*(?:참고용|참고|검증\s*필요|검증필요|확인\s*필요|확인필요|확인\s*불가|확인불가|확인\s*안\s*됨|확인안됨|정보\s*부족|정보부족|모름|미상|불명|주관적|개인적\s*의견|개인적인\s*의견|개인의견|예시|예시일\s*뿐|단지\s*참고|일반적|보통|대략|아마도|TBD|N\/?A|출처\s*없음)\s*[\)）\]】]/g
    // title·text 정제: [슬라이드 N] 라벨 제거 + 이모지 전면 제거 + role 강제 일반화
    if (Array.isArray(parsed.body)) {
      const prefixRe = /^\s*\[?\s*슬라이드\s*\d+\s*[·\]\-:]\s*/
      // 이모지 정규식 (텍스트 내 모든 이모지/픽토그램/심볼 제거)
      // CTA 슬라이드만 ❤️🔖➕💬 일부 액션 심볼 허용
      const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu
      // CTA 에서 보존할 안전한 이모지 (저장·팔로우·댓글 액션 심볼)
      const safeCta = /[❤️🔖➕💬👇✓✅]/g
      parsed.body = parsed.body.map((b, idx) => {
        const isLast = idx === parsed.body!.length - 1
        const isCta = b.role === 'cta' || isLast
        let title = (b.title || '').replace(prefixRe, '').replace(metaRe, '').trim()
        let text = (b.text || '').replace(prefixRe, '').replace(metaRe, '').trim()
        // 이모지 제거 (CTA 는 액션 심볼 보존)
        if (!isCta) {
          title = title.replace(emojiRe, '').replace(/\s{2,}/g, ' ').trim()
          text = text.replace(emojiRe, '').replace(/\s{2,}/g, ' ').trim()
        } else {
          // CTA 도 일반 이모지 제거하되 ❤️🔖➕💬 만 보존
          title = title.replace(emojiRe, m => safeCta.test(m) ? m : '').replace(/\s{2,}/g, ' ').trim()
          text = text.replace(emojiRe, m => safeCta.test(m) ? m : '').replace(/\s{2,}/g, ' ').trim()
        }
        return {
          ...b,
          // 모든 role 을 body / cta 둘 중 하나로 강제 (checklist/number/toc 제거)
          role: isCta ? 'cta' : (b.role === 'hook2' ? 'hook2' : 'body'),
          title,
          text,
          // 특수 필드 제거 (사용 안 함)
          list: undefined,
          big_number: undefined,
          sub: undefined,
          items: undefined,
        }
      })
    }
    // hook 과 cover_subtitle 의 이모지·메타 라벨도 제거
    const stripEmoji = (s?: string) => (s || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F9FF}]/gu, '').replace(metaRe, '').replace(/\s{2,}/g, ' ').trim()
    parsed.hook = stripEmoji(parsed.hook)
    parsed.cover_subtitle = stripEmoji(parsed.cover_subtitle)

    // hook ↔ body 일치 검증: hook 의 의미 키워드(숫자/한글 명사 ≥3자) 가 body 어디에도 없으면 1회 재요청
    const parsedNN: Parsed = parsed
    if (parsedNN.hook && Array.isArray(parsedNN.body)) {
      const hookKeywords = (parsedNN.hook!
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
        .match(/\d+|[가-힣A-Za-z]{3,}/g) || [])
        .filter(k => !['이거','진짜','대박','오늘','이건','그게','그래','그런','어떻','어디','얼마','정말','내가','나는','우리','때문','하지','했어','였어','드디어','정말로'].includes(k))
        .slice(0, 4)
      const bodyMerged = parsedNN.body!
        .filter(b => b.role !== 'cta')
        .map(b => `${b.title || ''} ${b.text || ''}`)
        .join(' ')
      const missing = hookKeywords.filter((kw: string) => !bodyMerged.includes(kw))
      // hook 의 핵심 키워드 50% 이상이 body 에 없으면 재요청 (1회만)
      if (hookKeywords.length >= 2 && missing.length / hookKeywords.length >= 0.5) {
        try {
          const fixPrompt = `${prompt}\n\n━━━ 추가 강제 조건: hook "${parsedNN.hook}" 에서 언급한 다음 키워드들은 body 슬라이드에 반드시 구체적으로 등장해야 한다: ${hookKeywords.join(', ')}\n각 키워드의 실제 이름·가격·위치 같은 구체 정보를 body 에 넣어. JSON 형식만 출력.`
          const fixRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_API_KEY!,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-5-20250929',
              max_tokens: 8000,
              messages: [{ role: 'user', content: fixPrompt }],
            }),
          })
          if (fixRes.ok) {
            const fixData = await fixRes.json()
            const fixText = fixData.content?.[0]?.text || ''
            const fixMatch = fixText.match(/\{[\s\S]*\}/)
            if (fixMatch) {
              const fixed = parseJson(fixMatch[0])
              if (fixed && Array.isArray(fixed.body) && fixed.body.length === parsedNN.body!.length) {
                parsedNN.hook = fixed.hook || parsedNN.hook
                parsedNN.body = fixed.body
                parsedNN.alt_hooks = fixed.alt_hooks || parsedNN.alt_hooks
              }
            }
          }
        } catch { /* 재요청 실패 시 원본 통과 */ }
      }
    }

    // 후킹 점수 서버측 재검증 (Claude 자체평가 참고)
    const serverScore = parsed.hook ? scoreHook(parsed.hook).total : 0
    const claudeScore = typeof parsed.hook_score === 'number' ? parsed.hook_score : 0
    // 저장 가치 / 바이럴 서버측 평가 (Claude self-score 보조 검증)
    const bodyTexts = (parsed.body || []).filter(b => b.role !== 'cta').map(b => `${b.title || ''} ${b.text || ''}`)
    const ctaText = (parsed.body || []).find(b => b.role === 'cta')?.text || ''
    const savServer = scoreSavability(bodyTexts).total
    const viralServer = scoreViral(parsed.hook || '', ctaText).total
    const savClaude = typeof parsed.savability_score === 'number' ? parsed.savability_score : 0
    const viralClaude = typeof parsed.viral_score === 'number' ? parsed.viral_score : 0

    // 팩트 검증 (high-risk claim 마킹) — 비치명, 실패해도 통과
    let factIssues: Array<{ slide: number; claim: string; risk: string; action: string }> = []
    try {
      const fcRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://ssobi.ai'}/api/cardnews/fact-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: req.headers.get('authorization') || '',
          cookie: req.headers.get('cookie') || '',
        },
        body: JSON.stringify({ body: parsed.body || [] }),
      })
      if (fcRes.ok) {
        const fc = await fcRes.json() as { issues?: typeof factIssues; cleaned?: BodySlide[] }
        factIssues = fc.issues || []
        // high risk 자동 마킹된 cleaned 적용
        if (Array.isArray(fc.cleaned) && fc.cleaned.length === parsed.body?.length) {
          parsed.body = parsed.body.map((b, i) => ({ ...b, text: fc.cleaned![i]?.text || b.text }))
        }
      }
    } catch { /* skip */ }

    // 이미지 계획 생성 (Pinterest/올영/Gemini 라우팅 근거)
    const cat = (parsed.category as ReturnType<typeof classifyCategory>) || category
    const imagePlan = planSlideImages({ topic, category: cat, slideCount })

    // 캡션 자동 조립 (Claude가 비웠을 경우) + 메타 라벨 제거
    const caption = ensureCaption({
      rawCaption: parsed.caption,
      hook: parsed.hook || topic,
      bodySlides: parsed.body || [],
      category: cat,
    }).replace(metaRe, '')
    // 두 번째 retry(hook keyword) 후 body 가 갱신됐을 수 있어 한 번 더 스트립 (안전장치)
    if (Array.isArray(parsed.body)) {
      parsed.body = parsed.body.map(b => ({
        ...b,
        title: (b.title || '').replace(metaRe, '').trim(),
        text: (b.text || '').replace(metaRe, '').trim(),
      }))
    }

    // DB에 잡 기록 (status draft)
    const { data: job } = await sb
      .from('card_news_jobs')
      .insert({
        user_id: user.id,
        topic,
        prompt_hook: parsed.hook || null,
        prompt_body: parsed.body || [],
        prompt_caption: caption,
        template: body.template || 'clean',
        slide_count: slideCount,
        status: 'draft',
        meta: {
          model: 'claude-sonnet-4-5-20250929',
          tokens: data.usage || null,
          category: cat,
          scope,
          image_keywords: parsed.image_keywords || [],
          image_plan: imagePlan,
          hook_score_claude: claudeScore,
          hook_score_server: serverScore,
          savability_score_claude: savClaude,
          savability_score_server: savServer,
          viral_score_claude: viralClaude,
          viral_score_server: viralServer,
          fact_issues: factIssues,
          recommended_templates: recommendedTemplates,
        },
      })
      .select('id')
      .single()

    // AI 토큰·비용 로그
    await logAIUsage({
      userId: user.id,
      feature: 'cardnews',
      model: 'claude-sonnet-4-5-20250929',
      usage: data.usage || {},
      refType: 'card_news_jobs',
      refId: job?.id,
    })

    // 개인화 데이터 누적: generated_count++ , category_history[cat]++
    try {
      const { data: prof } = await sb
        .from('profiles')
        .select('generated_count, category_history')
        .eq('id', user.id)
        .maybeSingle()
      const history = (prof?.category_history as Record<string, number>) || {}
      history[cat] = (history[cat] || 0) + 1
      await sb
        .from('profiles')
        .update({
          generated_count: (prof?.generated_count || 0) + 1,
          category_history: history,
        })
        .eq('id', user.id)
    } catch { /* 비치명 — 카운터 실패해도 응답은 정상 */ }

    return NextResponse.json({
      hook: parsed.hook || '',
      cover_subtitle: parsed.cover_subtitle || '',
      alt_hooks: parsed.alt_hooks || [],
      hook_score: claudeScore,
      hook_score_server: serverScore,
      viral_score: viralClaude,
      viral_score_server: viralServer,
      savability_score: savClaude,
      savability_score_server: savServer,
      body: parsed.body || [],
      caption,
      category: cat,
      scope,
      recommended_templates: recommendedTemplates,
      fact_issues: factIssues,
      image_keywords: parsed.image_keywords || [],
      image_plan: imagePlan,
      job_id: job?.id,
    })
  } catch (e) {
    return NextResponse.json({ error: 'generation failed', detail: String(e) }, { status: 500 })
  }
}
