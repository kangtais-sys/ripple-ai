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
} from '@/lib/cardnews-prompt'
import { NextRequest, NextResponse } from 'next/server'

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

  const prompt = buildContentGenerationPrompt({
    accountConcept,
    topic,
    researchData: body.researchData || '',
    slideCount,
    toneStyle: style,
    contentTone,
  })
  const category = classifyCategory(topic)

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
        max_tokens: 4096,
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
    type Entity = { type?: 'book' | 'product' | 'brand' | 'place'; name?: string }
    type BodySlide = {
      role?: string
      title?: string
      text?: string
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
          max_tokens: 4096,
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
        let title = (b.title || '').replace(prefixRe, '').trim()
        let text = (b.text || '').replace(prefixRe, '').trim()
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
    // hook 과 cover_subtitle 의 이모지도 제거
    const stripEmoji = (s?: string) => (s || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F9FF}]/gu, '').replace(/\s{2,}/g, ' ').trim()
    parsed.hook = stripEmoji(parsed.hook)
    parsed.cover_subtitle = stripEmoji(parsed.cover_subtitle)

    // 후킹 점수 서버측 재검증 (Claude 자체평가 참고)
    const serverScore = parsed.hook ? scoreHook(parsed.hook).total : 0
    const claudeScore = typeof parsed.hook_score === 'number' ? parsed.hook_score : 0

    // 이미지 계획 생성 (Pinterest/올영/Gemini 라우팅 근거)
    const cat = (parsed.category as ReturnType<typeof classifyCategory>) || category
    const imagePlan = planSlideImages({ topic, category: cat, slideCount })

    // 캡션 자동 조립 (Claude가 비웠을 경우)
    const caption = ensureCaption({
      rawCaption: parsed.caption,
      hook: parsed.hook || topic,
      bodySlides: parsed.body || [],
      category: cat,
    })

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
          image_keywords: parsed.image_keywords || [],
          image_plan: imagePlan,
          hook_score_claude: claudeScore,
          hook_score_server: serverScore,
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
      body: parsed.body || [],
      caption,
      category: cat,
      image_keywords: parsed.image_keywords || [],
      image_plan: imagePlan,
      job_id: job?.id,
    })
  } catch (e) {
    return NextResponse.json({ error: 'generation failed', detail: String(e) }, { status: 500 })
  }
}
