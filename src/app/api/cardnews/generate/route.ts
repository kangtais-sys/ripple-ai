// POST /api/cardnews/generate
// body: { topic: string, slides?: number (default 5) }
// resp: { hook, body: [{title, text}...], caption, job_id }
//
// 유저의 tone_profiles.learned_style을 읽어 그 말투로 캐러셀 프롬프트 생성

import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { logAIUsage } from '@/lib/ai-usage'
import { buildCardnewsSystemPrompt, classifyCategory } from '@/lib/cardnews-prompt'
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
  }
  const topic = (body.topic || '').trim()
  if (!topic || topic.length < 3) {
    return NextResponse.json({ error: '주제를 3자 이상 입력해주세요' }, { status: 400 })
  }
  const slideCount = Math.min(Math.max(body.slides || 6, 3), 10)
  const contentTone = body.contentTone

  // 유저의 학습된 말투 불러오기 (없으면 기본값)
  const { data: tone } = await sb
    .from('tone_profiles')
    .select('learned_style')
    .eq('user_id', user.id)
    .maybeSingle()
  const style = (tone?.learned_style as Record<string, unknown>) || {
    tone: '친근하고 밝은',
    sentence_ending: '~요, ~ㅎㅎ',
    emoji_style: '적절히 사용 (✨🌿😊)',
    length: '짧고 임팩트',
    characteristics: ['팔로워 공감', '저장 유도'],
  }

  // 카테고리 자동 분류 + 범용 시스템 프롬프트 생성
  const prompt = buildCardnewsSystemPrompt({ topic, slideCount, toneStyle: style, contentTone })
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

    let parsed: {
      hook?: string
      body?: Array<{ title?: string; text?: string }>
      caption?: string
      category?: string
      image_keywords?: string[]
    }
    try {
      parsed = JSON.parse(match[0])
    } catch {
      return NextResponse.json({ error: 'invalid JSON from Claude', raw: match[0] }, { status: 502 })
    }

    // DB에 잡 기록 (status draft)
    const { data: job } = await sb
      .from('card_news_jobs')
      .insert({
        user_id: user.id,
        topic,
        prompt_hook: parsed.hook || null,
        prompt_body: parsed.body || [],
        prompt_caption: parsed.caption || null,
        template: body.template || 'clean',
        slide_count: slideCount,
        status: 'draft',
        meta: {
          model: 'claude-sonnet-4-20250514',
          tokens: data.usage || null,
          category: parsed.category || category,
          image_keywords: parsed.image_keywords || [],
        },
      })
      .select('id')
      .single()

    // AI 토큰·비용 로그 (가격 책정 근거)
    await logAIUsage({
      userId: user.id,
      feature: 'cardnews',
      model: 'claude-sonnet-4-20250514',
      usage: data.usage || {},
      refType: 'card_news_jobs',
      refId: job?.id,
    })

    return NextResponse.json({
      hook: parsed.hook || '',
      body: parsed.body || [],
      caption: parsed.caption || '',
      category: parsed.category || category,
      image_keywords: parsed.image_keywords || [],
      job_id: job?.id,
    })
  } catch (e) {
    return NextResponse.json({ error: 'generation failed', detail: String(e) }, { status: 500 })
  }
}
