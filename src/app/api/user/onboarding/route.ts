// POST /api/user/onboarding — 온보딩 결과 저장
// GET  /api/user/onboarding — 현재 온보딩 데이터 조회
// 컬럼: onboarding_topics, onboarding_tone, onboarding_goal, onboarding_completed_at
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const VALID_TOPICS = new Set([
  'beauty','food','travel','fashion','interior','book',
  'baby','fit','money','life','cafe','trend',
])
const VALID_TONES = new Set(['warm','friendly','professional','honest','witty','chic'])
const VALID_GOALS = new Set(['grow','viral','brand','record'])

export async function POST(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    topics?: string[]
    tone?: string
    goal?: string
  }

  const topics = Array.isArray(body.topics)
    ? body.topics.filter(t => typeof t === 'string' && VALID_TOPICS.has(t)).slice(0, 3)
    : []
  const tone = typeof body.tone === 'string' && VALID_TONES.has(body.tone) ? body.tone : ''
  const goal = typeof body.goal === 'string' && VALID_GOALS.has(body.goal) ? body.goal : ''

  if (!topics.length || !tone || !goal) {
    return NextResponse.json({ error: 'incomplete' }, { status: 400 })
  }

  const sb = adminClient()
  const { error } = await sb
    .from('profiles')
    .update({
      onboarding_topics: topics,
      onboarding_tone: tone,
      onboarding_goal: goal,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: 'save_failed', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function GET(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sb = adminClient()
  const { data: profile } = await sb
    .from('profiles')
    .select('onboarding_topics, onboarding_tone, onboarding_goal, onboarding_completed_at')
    .eq('id', user.id)
    .maybeSingle()
  return NextResponse.json({
    ok: true,
    onboarding: {
      topics: profile?.onboarding_topics || [],
      tone: profile?.onboarding_tone || '',
      goal: profile?.onboarding_goal || '',
      completed_at: profile?.onboarding_completed_at || null,
    },
  })
}
