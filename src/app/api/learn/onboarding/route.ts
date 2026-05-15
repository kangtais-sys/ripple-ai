// POST /api/learn/onboarding
//   가입 직후 백그라운드 학습 — IG 게시물 분석으로 말투·페르소나 추출
//   + 검증용 예시 답안 5개 생성
//
// 흐름:
//   1. ig_accounts 의 access_token 으로 GET /me?fields=biography,name + GET /me/media
//   2. 최근 게시물 캡션 N개 + 본인이 단 답글 분석 → 말투 학습 prompt
//   3. 프로필 bio + 게시물 패턴 → 페르소나 추출
//   4. 시뮬레이션 질문 5개 + AI 답안 → 사용자 검증용
//   5. tone_profiles 저장 (validation_examples 에 5개 답안 포함)
//
// Body: { force?: boolean } — 이미 학습됐어도 재학습할지
// Response: { tone, persona, examples }

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

interface IGMedia {
  id: string
  caption?: string
  media_type?: string
  permalink?: string
  timestamp?: string
}

async function callClaude(prompt: string, maxTokens: number = 2000): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')
  const res = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data?.content?.[0]?.text || ''
}

export async function POST(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { force?: boolean }
  const sb = admin()

  // 1) 이미 학습됐는지 확인 (force=false 면 skip)
  if (!body.force) {
    const { data: existing } = await sb
      .from('tone_profiles')
      .select('validation_completed_at, learned_style, persona_summary, validation_examples')
      .eq('user_id', u.id)
      .maybeSingle()
    if (existing?.validation_completed_at && existing?.validation_examples) {
      return NextResponse.json({
        cached: true,
        tone: existing.learned_style,
        persona: existing.persona_summary,
        examples: existing.validation_examples,
      })
    }
  }

  // 2) IG access token 가져오기
  const { data: igAcc } = await sb
    .from('ig_accounts')
    .select('access_token, ig_username, account_type, media_count')
    .eq('user_id', u.id)
    .maybeSingle()
  if (!igAcc?.access_token) {
    return NextResponse.json({ error: 'no_ig_account' }, { status: 400 })
  }

  // 3) IG 메타 + 최근 게시물 fetch
  let bio = ''
  let mediaItems: IGMedia[] = []
  try {
    const meRes = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=biography,name,username&access_token=${igAcc.access_token}`
    )
    const me = await meRes.json()
    bio = me.biography || ''
  } catch {}

  try {
    const mRes = await fetch(
      `https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,permalink,timestamp&limit=30&access_token=${igAcc.access_token}`
    )
    const m = await mRes.json()
    mediaItems = (m.data || []) as IGMedia[]
  } catch {}

  const captions = mediaItems
    .map((m) => m.caption || '')
    .filter((c) => c && c.length > 10)
    .slice(0, 20)
    .join('\n\n---\n\n')

  if (!captions && !bio) {
    return NextResponse.json({ error: 'no_content_to_analyze' }, { status: 400 })
  }

  // 4) Claude 호출 — 말투·페르소나·검증 예시 5개 통합 분석
  const analysisPrompt = `다음은 인스타그램 인플루언서/크리에이터의 프로필 + 최근 게시물 캡션입니다.
이 사람의 말투·페르소나를 학습하고, 실제 팬이 보낼 만한 질문 5개에 대한 답안을 그 사람의 말투로 생성해주세요.

프로필 bio:
${bio || '(미설정)'}

@${igAcc.ig_username} · ${igAcc.account_type || 'BUSINESS'} · 게시물 ${igAcc.media_count || 0}개

최근 게시물 캡션:
${captions || '(캡션 없음)'}

다음 JSON 만 반환 (다른 설명·코드블록 X):
{
  "tone": {
    "summary": "한 줄 요약 (예: 친근한 반말 + 이모지 절제 + 줄바꿈 자주)",
    "style": "구체적 말투 설명 3-5줄",
    "vocabulary": ["자주 쓰는 단어/표현 5-10개"],
    "patterns": ["자주 쓰는 문장 패턴 3-5개"]
  },
  "persona": {
    "summary": "한 줄 요약 (예: 30대 K-뷰티 인플루언서, 자체 브랜드 운영)",
    "details": {
      "age_range": "추정 나이대",
      "expertise": ["전문 분야"],
      "interests": ["관심사"],
      "audience": "주요 팬 타겟"
    }
  },
  "examples": [
    {
      "question": "예시 질문 1 (이 사람한테 실제로 들어올 만한 질문)",
      "answer": "이 사람의 말투로 답한 응답 (자연스럽고 짧게)"
    },
    { "question": "예시 질문 2", "answer": "..." },
    { "question": "예시 질문 3", "answer": "..." },
    { "question": "예시 질문 4", "answer": "..." },
    { "question": "예시 질문 5", "answer": "..." }
  ]
}

규칙:
- 답안은 절대 *AI 처럼* 쓰지 말 것. 진짜 그 사람이 쓴 것처럼.
- 게시물에서 보이는 톤·이모지·줄바꿈·패턴 그대로
- 질문은 그 사람이 *진짜 받을 만한 것* (셀러면 가격·성분, 크리에이터면 콘텐츠 질문 등)
- 답안 1개당 50-150자`

  let analysis: {
    tone?: { summary?: string; style?: string; vocabulary?: string[]; patterns?: string[] }
    persona?: { summary?: string; details?: Record<string, unknown> }
    examples?: Array<{ question: string; answer: string }>
  } = {}

  try {
    const raw = await callClaude(analysisPrompt, 3000)
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    analysis = JSON.parse(cleaned)
  } catch (e) {
    console.error('[onboarding] Claude analysis failed:', e)
    return NextResponse.json({ error: 'analysis_failed', detail: String(e).slice(0, 200) }, { status: 500 })
  }

  // 5) tone_profiles 저장
  const { error: upErr } = await sb.from('tone_profiles').upsert({
    user_id: u.id,
    learned_style: analysis.tone,
    persona_summary: analysis.persona?.summary || null,
    persona_details: analysis.persona?.details || null,
    validation_examples: analysis.examples || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  if (upErr) {
    return NextResponse.json({ error: 'save_failed', detail: upErr.message }, { status: 500 })
  }

  return NextResponse.json({
    cached: false,
    tone: analysis.tone,
    persona: analysis.persona,
    examples: analysis.examples,
  })
}
