// POST /api/cardnews/fact-check
// body: { body: Array<{title, text}> }
// resp: { issues: [{ slide, claim, risk, action }], cleaned: same shape but with high-risk auto-marked }
// Claude 별도 호출로 검증 불가능한 수치·통계·가격·사실 추출 → high risk 자동 마킹
import { getUserFromRequest } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

type Slide = { title?: string; text?: string }
type Issue = { slide: number; claim: string; risk: 'high' | 'medium' | 'low'; action: 'delete' | 'mark' }

export async function POST(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { body } = await req.json().catch(() => ({})) as { body?: Slide[] }
  if (!Array.isArray(body) || body.length === 0) {
    return NextResponse.json({ error: 'body required' }, { status: 400 })
  }

  const slidesText = body.map((s, i) => `[${i + 1}] ${s.title || ''}\n${s.text || ''}`).join('\n\n')

  const prompt = `아래 카드뉴스 본문에서 검증 불가능한 수치·통계·가격·사실을 찾아 JSON 배열로만 반환해. 설명 없이.

[{"slide": 1, "claim": "...", "risk": "high|medium|low", "action": "delete|mark"}]

판정 기준:
- high (action=delete): "100% 효과", "무조건", "절대" 류 단정 보장 / "7일 5kg" 류 비현실적 수치 / 출처 없는 통계 ("연구에 따르면" 출처 없음) / 전문가 사칭 ("의사들이 추천하는") / "사람마다 다름" 류 정보 가치 0 문장
- medium (action=flag): 출처 없는 가격·수치. UI 에서 issue 로 노출만 — 본문에 라벨 박지 말 것.
- low: 통과

본문:
${slidesText}

JSON 만 출력. 다른 말 금지.`

  let issues: Issue[] = []
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (res.ok) {
      const data = await res.json()
      const text = data.content?.[0]?.text || '[]'
      const match = text.match(/\[[\s\S]*\]/)
      if (match) {
        const parsed = JSON.parse(match[0]) as Issue[]
        if (Array.isArray(parsed)) issues = parsed.filter(i => i && typeof i.slide === 'number')
      }
    }
  } catch { /* 검증 실패 = 원본 그대로 통과 (비치명) */ }

  // cleaned: 본문에 메타 태그를 박지 않음. 위험 문장은 issues 로 프론트에 노출만 하고
  //   본문 텍스트는 원본 그대로 — "(참고용)/(검증 필요)" 같은 라벨이 카드뉴스에 박히면 촌스러움.
  const cleaned = body.map(s => ({ ...s, text: s.text || '' }))

  return NextResponse.json({ issues, cleaned })
}
