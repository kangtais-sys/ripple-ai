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
import { NextRequest, NextResponse } from 'next/server'

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

  const researchData = (body.researchData || '') + scopeHint

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
        model: 'claude-sonnet-4-20250514',
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
          model: 'claude-sonnet-4-20250514',
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
              model: 'claude-sonnet-4-20250514',
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
          model: 'claude-sonnet-4-20250514',
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
      model: 'claude-sonnet-4-20250514',
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
