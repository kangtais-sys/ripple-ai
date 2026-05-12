// 페르소나 콘텐츠 생성기 — Claude API 호출
//
// 입력: 페르소나 + 샘플 + 토픽 기둥
// 출력: 채널별 draft 포스트 N개
//
// 호출 비용 추정 (claude-sonnet-4-5):
//   입력: bio + voice + 샘플 20개 + 토픽 = ~2,000 tokens × $0.003/1k = $0.006
//   출력: 5개 draft × 200자 = ~1,500 tokens × $0.015/1k = $0.023
//   합계: ~$0.03/페르소나/일 (월 ₩1,300/페르소나)

import { createClient as createAdminClient } from '@supabase/supabase-js'

interface Persona {
  id: string
  name: string
  language: 'ko' | 'en' | 'ja' | 'zh'
  bio: string | null
  voice_description: string
  channels: string[]
  topic_pillars: Array<{ name: string; weight: number }>
  daily_draft_count: number
}

interface Sample {
  content: string
  source_channel: string | null
}

export interface GeneratedDraft {
  topic_pillar: string
  channel: string
  content: string
}

const MODEL = 'claude-sonnet-4-5-20250929'

function buildPrompt(persona: Persona, samples: Sample[]): string {
  const sampleStr = samples.length > 0
    ? samples.slice(0, 20).map((s, i) => `${i + 1}. "${s.content.trim()}"`).join('\n')
    : '(샘플 없음 — voice_description 만 참고)'

  const pillarStr = persona.topic_pillars.length > 0
    ? persona.topic_pillars.map((p) => `${p.name} (${p.weight}%)`).join(' / ')
    : '빌드 인 퍼블릭 (40%) / 인플루언서 팁 (25%) / 제품 데모 (15%) / 도메인 인사이트 (10%) / 커뮤니티 (10%)'

  const channelStr = persona.channels.length > 0 ? persona.channels.join(', ') : 'threads, x'
  const langName = persona.language === 'ko' ? '한국어'
    : persona.language === 'en' ? '영어'
    : persona.language === 'ja' ? '일본어' : '중국어'

  return `당신은 "${persona.name}" 라는 가상 인플루언서입니다.

자기소개:
${persona.bio || '(미설정)'}

말투·톤:
${persona.voice_description}

작성 언어: ${langName}

콘텐츠 토픽 기둥 (가중치 비례 분배):
${pillarStr}

활성 채널: ${channelStr}
- threads, x: 텍스트 위주, 200자 이내
- instagram: 캡션 + 해시태그, 500자 이내
- facebook: 자유 길이 (500~1500자)

참고할 너의 평소 포스트 샘플 (이 톤·구조 유지):
${sampleStr}

---

지금 Ssobi (인플루언서용 SNS 자동화 SaaS) 마케팅 콘텐츠를 너의 톤으로 ${persona.daily_draft_count}개 작성해줘.

Ssobi 핵심 기능:
- AI 가 내 말투로 댓글·DM 자동 응대 (Instagram)
- 카드뉴스 1초 자동 생성 (Claude + 이미지)
- 내 링크 페이지 (Linktree 대체, 14종 블록 에디터)
- 한국+영어권 동시 결제 (NicePay + Stripe)
- 베타 기간 모든 가입자에게 PRO 무료

규칙:
1. 광고티 X. 빌드 인 퍼블릭 / 팁 / 솔직한 후기 톤으로
2. 각 포스트는 독립적 (시리즈 X)
3. 토픽 기둥 가중치에 맞게 분포
4. 해시태그는 자연스럽게 (Instagram 만, 3~5개)
5. 너의 평소 톤 유지 (위 샘플 참고)

응답은 다음 JSON 만 반환 (코드블록·설명 없이):
{
  "drafts": [
    { "topic_pillar": "빌드 인 퍼블릭", "channel": "threads", "content": "..." },
    ...
  ]
}`
}

export async function generateDraftsForPersona(personaId: string): Promise<{
  ok: boolean
  inserted?: number
  error?: string
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ok: false, error: 'missing_anthropic_key' }

  const sb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // 1) 페르소나 + 샘플 fetch
  const { data: personaRow, error: pErr } = await sb
    .from('marketing_personas')
    .select('*')
    .eq('id', personaId)
    .eq('active', true)
    .single()
  if (pErr || !personaRow) return { ok: false, error: 'persona_not_found' }
  const persona = personaRow as Persona

  const { data: sampleRows } = await sb
    .from('marketing_persona_samples')
    .select('content, source_channel')
    .eq('persona_id', personaId)
    .limit(20)
  const samples = (sampleRows || []) as Sample[]

  // 2) Claude 호출
  const prompt = buildPrompt(persona, samples)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    return { ok: false, error: `claude_${res.status}: ${err.slice(0, 200)}` }
  }
  const data = await res.json()
  const text: string = data?.content?.[0]?.text || ''

  // 3) JSON 파싱
  let drafts: GeneratedDraft[] = []
  try {
    // ``` 블록 또는 직접 JSON 둘 다 처리
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(cleaned)
    drafts = Array.isArray(parsed.drafts) ? parsed.drafts : []
  } catch {
    return { ok: false, error: 'parse_failed' }
  }
  if (drafts.length === 0) return { ok: false, error: 'no_drafts_generated' }

  // 4) draft 로 marketing_posts 에 insert
  const rows = drafts
    .filter((d) => d.content && d.channel)
    .map((d) => ({
      content: d.content.trim(),
      image_urls: [],
      channels: [d.channel],
      scheduled_at: new Date().toISOString(),  // 검수 후 사용자가 재설정
      status: 'draft' as const,
      persona_id: personaId,
      topic_pillar: d.topic_pillar || null,
    }))
  if (rows.length === 0) return { ok: false, error: 'empty_drafts' }

  const { error: insErr } = await sb.from('marketing_posts').insert(rows)
  if (insErr) return { ok: false, error: `insert_failed: ${insErr.message}` }

  return { ok: true, inserted: rows.length }
}
