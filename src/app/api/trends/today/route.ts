// GET /api/trends/today  (인증 있으면 개인화, 없으면 공용)
// 1) 로그인 유저 + onboarding 완료 → user_daily_recs 우선
// 2) 폴백: daily_trends.recommended_topics
// 3) 폴백 폴백: 최근 7일 내 가장 최신 daily_trends
import { createClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const now = new Date()
  const kstNow = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60 * 1000)
  const todayKst = kstNow.toISOString().slice(0, 10)

  // 1) 개인화 (로그인 + 온보딩 완료)
  const user = await getUserFromRequest(req).catch(() => null)
  if (user) {
    const { data: personal } = await sb
      .from('user_daily_recs')
      .select('date_kst, topics')
      .eq('user_id', user.id)
      .eq('date_kst', todayKst)
      .maybeSingle()
    if (personal?.topics && Array.isArray(personal.topics) && personal.topics.length > 0) {
      return NextResponse.json({
        ok: true,
        fresh: true,
        personalized: true,
        date_kst: personal.date_kst,
        topics: personal.topics,
      })
    }
  }

  // 2) 공용 오늘
  const { data: today } = await sb
    .from('daily_trends')
    .select('date_kst, recommended_topics, generated_at')
    .eq('date_kst', todayKst)
    .maybeSingle()

  if (today?.recommended_topics && Array.isArray(today.recommended_topics) && today.recommended_topics.length > 0) {
    return NextResponse.json({
      ok: true,
      fresh: true,
      personalized: false,
      date_kst: today.date_kst,
      topics: today.recommended_topics,
    })
  }

  // 3) 최근 7일 폴백
  const sevenAgo = new Date(kstNow.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data: recent } = await sb
    .from('daily_trends')
    .select('date_kst, recommended_topics, generated_at')
    .gte('date_kst', sevenAgo)
    .order('date_kst', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (recent?.recommended_topics && Array.isArray(recent.recommended_topics) && recent.recommended_topics.length > 0) {
    return NextResponse.json({
      ok: true,
      fresh: false,
      personalized: false,
      date_kst: recent.date_kst,
      topics: recent.recommended_topics,
    })
  }

  return NextResponse.json({ ok: false, topics: [] })
}
