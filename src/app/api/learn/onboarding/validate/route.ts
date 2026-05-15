// POST /api/learn/onboarding/validate
//   가입 검증 단계 — 사용자가 5개 예시 답안에 [좋아요]/[수정]
//   수정한 답안은 user_corrections 에 학습 보정으로 저장
//
// Body: { corrections: Array<{ question, original, edited }> }
// Response: { ok }

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'

export const dynamic = 'force-dynamic'

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

  const body = await req.json().catch(() => ({})) as {
    corrections?: Array<{ question: string; original: string; edited: string }>
  }
  const corrections = (body.corrections || []).filter((c) => c.edited && c.edited !== c.original)

  const sb = admin()

  // 1) tone_profiles 의 user_corrections 에 누적 저장
  const { data: existing } = await sb
    .from('tone_profiles')
    .select('user_corrections')
    .eq('user_id', u.id)
    .maybeSingle()
  const existingCorrections = Array.isArray(existing?.user_corrections) ? existing.user_corrections : []
  const newCorrections = [...existingCorrections, ...corrections.map((c) => ({
    ...c,
    at: new Date().toISOString(),
  }))]

  await sb.from('tone_profiles').update({
    user_corrections: newCorrections,
    validation_completed_at: new Date().toISOString(),
  }).eq('user_id', u.id)

  // 2) profiles 에 tone_validated=true + draft_mode_until=+7일
  await sb.from('profiles').update({
    tone_validated: true,
    draft_mode_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }).eq('id', u.id)

  return NextResponse.json({ ok: true, corrections_saved: corrections.length })
}
