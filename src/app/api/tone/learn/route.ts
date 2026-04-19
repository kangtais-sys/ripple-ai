import { createClient } from '@/lib/supabase/server'
import { logAIUsage } from '@/lib/ai-usage'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `아래는 한 사람이 SNS에서 실제로 작성한 댓글/답글 샘플입니다. 이 사람의 말투 특성을 분석해서 JSON으로 반환해주세요.

샘플:
${samples.map((s: string, i: number) => `${i + 1}. "${s}"`).join('\n')}

다음 항목을 분석해서 JSON만 반환:
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

  const data = await res.json()
  const text = data.content?.[0]?.text || '{}'
  const match = text.match(/\{[\s\S]*\}/)
  const learnedStyle = match ? JSON.parse(match[0]) : null

  if (!learnedStyle) {
    return NextResponse.json({ error: '분석 실패' }, { status: 500 })
  }

  // Supabase에 저장
  await supabase.from('tone_profiles').upsert({
    user_id: user.id,
    sample_texts: samples,
    learned_style: learnedStyle,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

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

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('tone_profiles')
    .select('sample_texts, learned_style, updated_at')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json(data || { sample_texts: [], learned_style: null })
}
