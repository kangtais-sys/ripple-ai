// POST /api/cardnews/classify
// body: { topic: string }
// resp: { category: CategoryKey, scope: 'kr'|'global'|'mixed' }
// regex 기반 classifyCategory 의 보완 — Claude 위임으로 17카테고리 정확 분류
import { getUserFromRequest } from '@/lib/auth-helper'
import { classifyCategory, detectScope, type CategoryKey } from '@/lib/cardnews-prompt'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const VALID: CategoryKey[] = [
  'beauty_treatment','beauty_product','beauty_ingredient','beauty_trouble',
  'food','cafe','travel_domestic','travel_abroad',
  'fashion','interior','fitness','money_tip','price_compare',
  'trend','review','life_tip','book','etc',
]

export async function POST(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { topic } = await req.json().catch(() => ({})) as { topic?: string }
  const t = (topic || '').trim()
  if (!t || t.length < 2) return NextResponse.json({ error: 'topic required' }, { status: 400 })

  // 스코프는 항상 키워드 기반 (가벼움)
  const scope = detectScope(t)

  // Claude 분류 시도, 실패 시 regex fallback
  let category: CategoryKey = classifyCategory(t)
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
        max_tokens: 80,
        messages: [{
          role: 'user',
          content: `주제를 읽고 아래 18개 중 가장 적합한 카테고리 1개를 JSON 으로만 반환. 설명 없이 {"category": "..."} 형식만.

카테고리: beauty_treatment / beauty_product / beauty_ingredient / beauty_trouble / food / cafe / travel_domestic / travel_abroad / fashion / interior / fitness / money_tip / price_compare / trend / review / life_tip / book / etc

주제: "${t}"`,
        }],
      }),
    })
    if (res.ok) {
      const data = await res.json()
      const text = data.content?.[0]?.text || ''
      const match = text.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0]) as { category?: string }
        if (parsed.category && VALID.includes(parsed.category as CategoryKey)) {
          category = parsed.category as CategoryKey
        }
      }
    }
  } catch { /* regex fallback 사용 */ }

  return NextResponse.json({ category, scope })
}
