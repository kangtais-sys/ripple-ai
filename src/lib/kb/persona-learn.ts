// src/lib/kb/persona-learn.ts
// IG 프로필 bio + 최근 게시물 → 말투(tone)·캐릭터(persona)·검증예시 추출 (공유 lib)
//   사용처:
//     - api/learn/onboarding (수동 재학습 라우트)
//     - inngest/workers/learn-ig-persona (IG 연동 시 자동 학습 워커)
//   외부 의존: Instagram Graph API, Claude (Anthropic)

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929'

export interface PersonaAnalysis {
  tone?: { summary?: string; style?: string; vocabulary?: string[]; patterns?: string[] }
  persona?: { summary?: string; details?: Record<string, unknown> }
  examples?: Array<{ question: string; answer: string }>
}

interface IGMedia {
  id: string
  caption?: string
  media_type?: string
  permalink?: string
  timestamp?: string
}

async function callClaude(prompt: string, maxTokens = 3000): Promise<string> {
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

/**
 * IG 프로필 bio + 최근 게시물 캡션을 가져온다.
 * @param limit 학습에 쓸 캡션 개수(>10자 필터). 기본 10.
 *   캡션 없는 게시물이 섞이므로 limit의 2배(최소 20)를 요청해 채운다.
 */
export async function fetchIgProfileAndPosts(
  accessToken: string,
  limit = 10,
): Promise<{ bio: string; captions: string; captionCount: number }> {
  let bio = ''
  let mediaItems: IGMedia[] = []
  try {
    const meRes = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=biography,name,username&access_token=${accessToken}`,
    )
    const me = await meRes.json()
    bio = me.biography || ''
  } catch {}
  try {
    const fetchN = Math.max(limit * 2, 20)
    const mRes = await fetch(
      `https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,permalink,timestamp&limit=${fetchN}&access_token=${accessToken}`,
    )
    const m = await mRes.json()
    mediaItems = (m.data || []) as IGMedia[]
  } catch {}
  const captionsArr = mediaItems
    .map((m) => m.caption || '')
    .filter((c) => c && c.length > 10)
    .slice(0, limit)
  return { bio, captions: captionsArr.join('\n\n---\n\n'), captionCount: captionsArr.length }
}

/** bio + 캡션 → Claude Sonnet 으로 말투·페르소나·검증예시 5개 추출 */
export async function analyzePersona(input: {
  bio: string
  captions: string
  igUsername: string
  accountType?: string | null
  mediaCount?: number | null
}): Promise<PersonaAnalysis> {
  const { bio, captions, igUsername, accountType, mediaCount } = input

  const analysisPrompt = `다음은 인스타그램 인플루언서/크리에이터의 프로필 + 최근 게시물 캡션입니다.
이 사람의 말투·페르소나를 학습하고, 실제 팬이 보낼 만한 질문 5개에 대한 답안을 그 사람의 말투로 생성해주세요.

프로필 bio:
${bio || '(미설정)'}

@${igUsername} · ${accountType || 'BUSINESS'} · 게시물 ${mediaCount || 0}개

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
    "summary": "한 줄 요약 (이 계정의 카테고리·연령대·주력 활동을 학습 데이터에서 추정. 미리 특정 분야로 단정하지 말 것)",
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

  const raw = await callClaude(analysisPrompt, 3000)
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(cleaned) as PersonaAnalysis
}
