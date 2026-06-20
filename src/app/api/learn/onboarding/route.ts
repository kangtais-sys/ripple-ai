// POST /api/learn/onboarding
//   수동 재학습 — IG 게시물 분석으로 말투·페르소나 추출 + 검증용 예시 5개 생성.
//   (IG 연동 시 자동 학습은 inngest/workers/learn-ig-persona 워커가 담당. 둘 다 persona-learn lib 공용)
//
// Body: { force?: boolean } — 이미 학습됐어도 재학습할지
// Response: { tone, persona, examples }

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { fetchIgProfileAndPosts, analyzePersona } from '@/lib/kb/persona-learn'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
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

  // 3) IG bio + 최근 게시물 (공유 lib)
  const { bio, captions } = await fetchIgProfileAndPosts(igAcc.access_token, 10)
  if (!captions && !bio) {
    return NextResponse.json({ error: 'no_content_to_analyze' }, { status: 400 })
  }

  // 4) Claude 분석 (공유 lib)
  let analysis
  try {
    analysis = await analyzePersona({
      bio,
      captions,
      igUsername: igAcc.ig_username,
      accountType: igAcc.account_type,
      mediaCount: igAcc.media_count,
    })
  } catch (e) {
    console.error('[onboarding] persona analysis failed:', e)
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

  // 학습 완료 마킹 (UI '완료' 신호)
  await sb.from('profiles').update({ tone_learned_at: new Date().toISOString() }).eq('id', u.id)

  return NextResponse.json({
    cached: false,
    tone: analysis.tone,
    persona: analysis.persona,
    examples: analysis.examples,
  })
}
