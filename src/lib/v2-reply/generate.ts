// Claude 응답 생성 — 말투·페르소나·KB 차등 컨텍스트 주입
//
// 컨텍스트 빌딩 (4단계 차등):
// - 일반 문의   → 팬 요약 + 최근 대화 3개 + RAG 5청크
// - 재구매 고객 → 팬 요약 + 최근 대화 10개 + 구매 이력
// - VIP        → 팬 요약 + 전체 대화 AI 요약 + 최근 10개
// - 긴급/불만   → 전체 대화 AI 요약 + 긴급 컨텍스트 우선

import type { SupabaseClient } from '@supabase/supabase-js'
import { searchKnowledge } from './rag'
import type { IntentResult } from './intent'

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929'

export interface GenerateInput {
  userId: string
  fanId: string | null
  message: string
  channel: 'dm' | 'comment'
  intent: IntentResult
}

export interface GenerateResult {
  reply: string
  used_chunks: string[]    // KB chunk IDs 사용
  used_recent_count: number  // 최근 대화 N개 사용
  tone_applied: boolean
  context_tier: 'general' | 'returning' | 'vip' | 'urgent'
}

function pickContextTier(fanProfile: {
  is_vip?: boolean
  conversation_count?: number
  estimated_purchase_count?: number
} | null, intent: IntentResult): GenerateResult['context_tier'] {
  if (intent.is_urgent) return 'urgent'
  if (fanProfile?.is_vip) return 'vip'
  if ((fanProfile?.estimated_purchase_count ?? 0) >= 1) return 'returning'
  return 'general'
}

export async function generateReply(
  sb: SupabaseClient,
  input: GenerateInput,
): Promise<GenerateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')

  // 1) 톤·페르소나
  const { data: tone } = await sb
    .from('tone_profiles')
    .select('learned_style, persona_summary, persona_details, user_corrections')
    .eq('user_id', input.userId)
    .maybeSingle()

  // 2) 팬 프로필
  let fan: { is_vip?: boolean; conversation_count?: number; estimated_purchase_count?: number; profile_summary?: string } | null = null
  if (input.fanId) {
    const { data } = await sb
      .from('fan_profiles')
      .select('is_vip, conversation_count, estimated_purchase_count, profile_summary')
      .eq('id', input.fanId)
      .maybeSingle()
    fan = data
  }

  const tier = pickContextTier(fan, input.intent)

  // 3) RAG 검색
  const kbLimit = tier === 'urgent' ? 7 : 5
  const chunks = await searchKnowledge(sb, input.userId, input.message, kbLimit)
  const kbContext = chunks.map((c, i) =>
    `[${i + 1}] (${c.source_type}${c.source_label ? ' · ' + c.source_label : ''}, priority=${c.priority})\n${c.content}`
  ).join('\n\n')

  // 4) 최근 대화 (tier 별)
  let recentCount = 0
  let recentContext = ''
  if (input.fanId) {
    const limit = tier === 'general' ? 3 : tier === 'returning' ? 10 : tier === 'vip' ? 10 : 5
    const { data: convs } = await sb
      .from('conversations')
      .select('direction, content, created_at')
      .eq('user_id', input.userId)
      .eq('fan_id', input.fanId)
      .order('created_at', { ascending: false })
      .limit(limit)
    recentCount = convs?.length || 0
    recentContext = (convs || [])
      .reverse()
      .map((c) => `${c.direction === 'inbound' ? '고객' : '나'}: ${c.content}`)
      .join('\n')
  }

  // 5) 시스템 프롬프트
  const personaLine = tone?.persona_summary
    ? `당신은 ${tone.persona_summary} 입니다.`
    : '당신은 인플루언서·셀러·크리에이터입니다.'
  const toneSection = typeof tone?.learned_style === 'object'
    ? JSON.stringify(tone.learned_style)
    : (tone?.learned_style || '친근하고 자연스러운 말투')
  const correctionsList = Array.isArray(tone?.user_corrections) ? tone.user_corrections : []

  const systemPrompt = `${personaLine}

말투·페르소나:
${toneSection}

${correctionsList.length > 0 ? `사용자 수정 사례 (학습된 보정):\n${JSON.stringify(correctionsList).slice(0, 1000)}\n` : ''}

응대 원칙:
- 자기 말투 그대로 (봇 티 X)
- 친근하고 짧게 (인스타 DM·댓글 톤)
- 줄바꿈 자연스럽게
- 이모지 절제
- 확실하지 않은 정보는 추측 X (모르면 "확인해볼게요" 같은 솔직한 답변)
- 24시간 응대 윈도우 안에서만 발송 가능
${input.intent.is_urgent ? '- 긴급 문의 — 공감 먼저, 해결책 제시 (환불·반품·불량 등은 명확한 안내)' : ''}`

  // 6) 사용자 메시지
  const userMessage = [
    fan?.profile_summary ? `[팬 정보]\n${fan.profile_summary}\n` : '',
    recentContext ? `[최근 대화]\n${recentContext}\n` : '',
    kbContext ? `[관련 지식]\n${kbContext}\n` : '',
    `[현재 메시지 (${input.channel}, intent=${input.intent.intent}, sentiment=${input.intent.sentiment})]\n${input.message}`,
    '',
    `위 정보를 바탕으로 응답해주세요. 응답만 작성하고 다른 설명·메타텍스트 X.`,
  ].filter(Boolean).join('\n\n')

  const res = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    signal: AbortSignal.timeout(20000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude ${res.status}: ${err.slice(0, 200)}`)
  }
  const data = await res.json()
  const reply = (data?.content?.[0]?.text || '').trim()
  if (!reply) throw new Error('empty_reply')

  return {
    reply,
    used_chunks: chunks.map((c) => c.id),
    used_recent_count: recentCount,
    tone_applied: !!tone?.learned_style,
    context_tier: tier,
  }
}
