// GET /api/trends/today  (인증 불필요 · 공용 추천)
// 오늘 날짜의 recommended_topics 3개 반환. 없으면 최근 7일 내 가장 최신 것.
// 프론트 만들기 탭 "FOR YOU · 오늘 주제" 섹션에서 사용
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // KST 오늘 날짜
  const now = new Date()
  const kstNow = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60 * 1000)
  const todayKst = kstNow.toISOString().slice(0, 10)

  // 오늘 → 못 찾으면 최근 7일 내 가장 최신
  const { data: today } = await sb
    .from('daily_trends')
    .select('date_kst, recommended_topics, generated_at')
    .eq('date_kst', todayKst)
    .maybeSingle()

  if (today?.recommended_topics && Array.isArray(today.recommended_topics) && today.recommended_topics.length > 0) {
    return NextResponse.json({
      ok: true,
      fresh: true,
      date_kst: today.date_kst,
      topics: today.recommended_topics,
    })
  }

  // 폴백: 최근 7일 내 가장 최신
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
      date_kst: recent.date_kst,
      topics: recent.recommended_topics,
    })
  }

  return NextResponse.json({ ok: false, topics: [] })
}
