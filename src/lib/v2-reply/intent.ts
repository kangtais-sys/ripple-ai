// 4-way 의도 분류 (Claude Haiku 빠른 분류)
//
// purchase_intent   — 구매 의향 ("어디서 살 수 있어요?", "할인되나요?")
// product_inquiry   — 제품/콘텐츠 정보 ("성분 뭐예요?", "다음 영상 언제?")
// schedule_inquiry  — 일정·재고·이벤트 ("공구 마감 언제?", "강의 일정?")
// urgent            — 긴급/불만/환불/이상 ("환불 가능?", "이상해요")

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'  // 빠른·저렴 분류용

export type IntentType = 'purchase_intent' | 'product_inquiry' | 'schedule_inquiry' | 'urgent' | 'other'
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'unknown'

export interface IntentResult {
  intent: IntentType
  sentiment: Sentiment
  is_urgent: boolean
  reason: string
}

const URGENT_KEYWORDS = [
  '환불', '반품', '취소', '불량', '문제', '이상해', '실망', '화나', '짜증',
  '못받', '안와', '안왔', '신고', '고소', '소송',
  'refund', 'broken', 'wrong', 'never received', 'disappointed', 'angry', 'lawsuit', 'sue',
]

/**
 * Rule-based fallback — Claude 사용 불가 또는 미설정 시.
 * 키워드 매칭으로 단순 분류.
 */
function ruleBasedClassify(message: string): IntentResult {
  const lower = message.toLowerCase()

  if (URGENT_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { intent: 'urgent', sentiment: 'negative', is_urgent: true, reason: 'keyword_match' }
  }
  if (/(\d만원|\d원|얼마|가격|할인|sale|price|how much|where can i buy)/.test(lower)) {
    return { intent: 'purchase_intent', sentiment: 'neutral', is_urgent: false, reason: 'rule_purchase' }
  }
  if (/(언제|일정|마감|재고|품절|sched|when|in stock|sold out)/.test(lower)) {
    return { intent: 'schedule_inquiry', sentiment: 'neutral', is_urgent: false, reason: 'rule_schedule' }
  }
  if (/(\?|성분|효과|어떻게|how|what)/.test(lower)) {
    return { intent: 'product_inquiry', sentiment: 'neutral', is_urgent: false, reason: 'rule_inquiry' }
  }
  return { intent: 'other', sentiment: 'neutral', is_urgent: false, reason: 'no_match' }
}

export async function classifyIntent(message: string): Promise<IntentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !message.trim()) {
    return ruleBasedClassify(message)
  }

  const prompt = `다음 인스타그램 댓글/DM 메시지를 분석해서 JSON으로만 응답해줘. 다른 설명 X.

분류:
- purchase_intent: 구매 의향 표현 (어디서 살지, 할인, 가격 등)
- product_inquiry: 제품/서비스 정보 질문 (성분·효과·사용법·내용물)
- schedule_inquiry: 일정·재고·이벤트·마감 질문
- urgent: 긴급/불만/환불/문제/이상 (감정적·부정적)
- other: 위에 안 맞는 일상 대화

감정:
- positive / neutral / negative / unknown

메시지: "${message.slice(0, 500)}"

JSON 형식 (다른 설명 없이):
{"intent":"...","sentiment":"...","is_urgent":true|false,"reason":"한 줄 설명"}`

  try {
    const res = await fetch(CLAUDE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return ruleBasedClassify(message)
    const data = await res.json()
    const raw = data?.content?.[0]?.text || ''
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(cleaned)
    return {
      intent: parsed.intent || 'other',
      sentiment: parsed.sentiment || 'unknown',
      is_urgent: !!parsed.is_urgent || parsed.intent === 'urgent',
      reason: parsed.reason || '',
    }
  } catch (e) {
    console.error('[v2-reply/intent] Claude failed, fallback:', e)
    return ruleBasedClassify(message)
  }
}
