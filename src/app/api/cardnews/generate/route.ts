// POST /api/cardnews/generate
// body: { topic: string, slides?: number (default 5) }
// resp: { hook, body: [{title, text}...], caption, job_id }
//
// 유저의 tone_profiles.learned_style을 읽어 그 말투로 캐러셀 프롬프트 생성

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { topic?: string; slides?: number; template?: string }
  const topic = (body.topic || '').trim()
  if (!topic || topic.length < 3) {
    return NextResponse.json({ error: '주제를 3자 이상 입력해주세요' }, { status: 400 })
  }
  const slideCount = Math.min(Math.max(body.slides || 5, 3), 10)

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

  // Claude 호출
  const prompt = `너는 K-뷰티·라이프스타일 인플루언서의 SNS 캐러셀(카드뉴스) 카피라이터야.
아래 말투로 "${topic}"에 대한 ${slideCount}장 캐러셀을 만들어줘.

말투:
- 어조: ${style.tone}
- 종결어미: ${style.sentence_ending}
- 이모지: ${style.emoji_style}
- 길이: ${style.length}
- 특징: ${Array.isArray(style.characteristics) ? (style.characteristics as string[]).join(', ') : ''}

요구사항:
1. 1장(표지): 강한 후킹 문구 한 줄 (짧고 임팩트, 20자 이내)
2. 2장(프리뷰): "오늘 알려드릴 N가지" 목차형 (3~4줄)
3. 3~${slideCount - 1}장(본문): 각 슬라이드 짧은 제목(10자 이내) + 본문(2~3줄)
4. ${slideCount}장(마지막): 질문형 CTA + 저장·댓글 유도

그리고 게시 캡션도 만들어줘. 해시태그 6~10개 포함.

반드시 아래 JSON 형식으로만 응답 (코드블록 없이):
{
  "hook": "표지 후킹 문구",
  "body": [
    {"title": "2장 제목", "text": "2장 본문 (개행은 \\n)"},
    {"title": "3장 제목", "text": "3장 본문"},
    ...
    {"title": "마지막장 제목", "text": "마지막장 본문"}
  ],
  "caption": "게시 캡션 (해시태그 포함)"
}`

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
        max_tokens: 2048,
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

    let parsed: { hook?: string; body?: Array<{ title?: string; text?: string }>; caption?: string }
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
        meta: { model: 'claude-sonnet-4-20250514', tokens: data.usage || null },
      })
      .select('id')
      .single()

    return NextResponse.json({
      hook: parsed.hook || '',
      body: parsed.body || [],
      caption: parsed.caption || '',
      job_id: job?.id,
    })
  } catch (e) {
    return NextResponse.json({ error: 'generation failed', detail: String(e) }, { status: 500 })
  }
}
