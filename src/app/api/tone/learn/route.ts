import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { logAIUsage } from '@/lib/ai-usage'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = adminClient()
  const { samples } = await request.json()

  if (!Array.isArray(samples) || samples.length < 3) {
    return NextResponse.json({ error: '최소 3개의 샘플 텍스트가 필요합니다' }, { status: 400 })
  }

  // Claude로 말투 분석
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
      messages: [{
        role: 'user',
        content: `아래는 한 사람이 SNS(Instagram)에서 실제로 작성한 게시물 캡션 또는 댓글 샘플입니다. 이 사람이 팔로워의 댓글/DM에 답글을 달 때 어떻게 쓸지 예측 가능하도록 말투 특성을 분석해서 JSON으로 반환해주세요.

샘플:
${samples.map((s: string, i: number) => `${i + 1}. "${s}"`).join('\n')}

다음 항목을 분석해서 JSON만 반환 (코드블록·설명 없이):
{
  "tone": "전체적 어조 (예: 친근함, 프로페셔널, 캐주얼 등)",
  "sentence_ending": "자주 쓰는 문장 종결어미 목록 (예: ~요, ~ㅎㅎ, ~! 등)",
  "emoji_style": "이모지 사용 패턴 (빈도, 주로 쓰는 이모지)",
  "length": "평균 답글 길이 (짧은/보통/긴)",
  "characteristics": ["특징1", "특징2", "특징3"],
  "example_reply": "이 말투로 '제품 어디서 사요?'에 대한 예시 답글"
}`,
      }],
    }),
  })

  if (!res.ok) {
    const errTxt = await res.text().catch(() => '')
    return NextResponse.json({ error: 'Claude API 에러', detail: errTxt }, { status: 502 })
  }

  const data = await res.json()
  const text = data.content?.[0]?.text || '{}'
  const match = text.match(/\{[\s\S]*\}/)
  let learnedStyle: Record<string, unknown> | null = null
  if (match) {
    try { learnedStyle = JSON.parse(match[0]) } catch { learnedStyle = null }
  }
  if (!learnedStyle) {
    return NextResponse.json({ error: '분석 실패 (JSON 파싱)', raw: text.slice(0, 300) }, { status: 500 })
  }

  // profiles row 없으면 생성 (FK 위반 방지 — 데모 초기화 후 케이스)
  const { data: existingProfile } = await supabase
    .from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (!existingProfile) {
    const { error: pErr } = await supabase.from('profiles').insert({ id: user.id })
    if (pErr) {
      console.error('[tone/learn] profiles insert error:', pErr)
      return NextResponse.json({ error: 'profiles_insert_failed', detail: pErr.message }, { status: 500 })
    }
  }

  // UNIQUE 제약 의존 없이 저장 (migration 누락 대비)
  //   1) 기존 row 있으면 update
  //   2) 없으면 insert
  const { data: existingTone } = await supabase
    .from('tone_profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  let saveErr: { message?: string; code?: string } | null = null
  if (existingTone) {
    const { error } = await supabase
      .from('tone_profiles')
      .update({
        sample_texts: samples,
        learned_style: learnedStyle,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
    saveErr = error
  } else {
    const { error } = await supabase.from('tone_profiles').insert({
      user_id: user.id,
      sample_texts: samples,
      learned_style: learnedStyle,
      updated_at: new Date().toISOString(),
    })
    saveErr = error
  }

  if (saveErr) {
    console.error('[tone/learn] save error:', saveErr)
    return NextResponse.json({
      error: 'db_save_failed',
      detail: saveErr.message,
      code: saveErr.code,
    }, { status: 500 })
  }

  // AI 토큰·비용 로그
  await logAIUsage({
    userId: user.id,
    feature: 'tone_learn',
    model: 'claude-sonnet-4-20250514',
    usage: data.usage || {},
    refType: 'tone_profiles',
    refId: user.id,
  })

  return NextResponse.json({ success: true, style: learnedStyle })
}

export async function GET(request: Request) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = adminClient()
  const { data } = await supabase
    .from('tone_profiles')
    .select('sample_texts, learned_style, updated_at')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json(data || { sample_texts: [], learned_style: null })
}
