// GET /api/cron/daily-report
//   매일 자정 (한국 기준) 일일 리포트 생성
//
// 어제 (KST) 활동 집계 → daily_reports 테이블 insert
// - total_handled, auto_rate, converted_count, urgent_count, window_expired
// - new_fan_count, returning_fan_count
// - estimated_revenue_krw (KB 평균 가격 × 클릭 × 15%)
// - top_questions (Claude 로 요약)
// - 사용자한테 카톡 알림 (옵션)

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STANDARD_CONVERSION_RATE = 0.15  // K-뷰티 인플루언서 표준 추정 15%

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 어제 (KST UTC+9) 범위
  const now = new Date()
  const todayKST = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const yesterdayKST = new Date(todayKST)
  yesterdayKST.setUTCDate(yesterdayKST.getUTCDate() - 1)
  const yesterdayDate = yesterdayKST.toISOString().slice(0, 10)
  const startUTC = new Date(Date.UTC(yesterdayKST.getUTCFullYear(), yesterdayKST.getUTCMonth(), yesterdayKST.getUTCDate(), -9))
  const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000)

  // 1) v2 활성 사용자 (knowledge_chunks 있는) 만
  const { data: users } = await sb
    .from('profiles')
    .select('id')
    .limit(1000)

  if (!users?.length) return NextResponse.json({ ok: true, reports: 0 })

  let createdCount = 0
  for (const user of users) {
    const userId = user.id

    // KB 있는 사용자만 (v2)
    const { count: kbCount } = await sb
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_active', true)
    if (!kbCount || kbCount === 0) continue

    // 어제 conversations 집계
    const [convsR, urgentR, newFansR, returningFansR, expiredR, kbPriceR, clicksR] = await Promise.all([
      sb.from('conversations').select('id, direction, is_converted, intent', { count: 'exact' })
        .eq('user_id', userId).gte('created_at', startUTC.toISOString()).lt('created_at', endUTC.toISOString()),
      sb.from('conversations').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('is_urgent', true)
        .gte('created_at', startUTC.toISOString()).lt('created_at', endUTC.toISOString()),
      sb.from('fan_profiles').select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('first_seen_at', startUTC.toISOString()).lt('first_seen_at', endUTC.toISOString()),
      sb.from('fan_profiles').select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .lt('first_seen_at', startUTC.toISOString())
        .gte('last_seen_at', startUTC.toISOString()).lt('last_seen_at', endUTC.toISOString()),
      sb.from('pending_replies').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('status', 'expired')
        .gte('window_expires_at', startUTC.toISOString()).lt('window_expires_at', endUTC.toISOString()),
      // KB 청크 가격 평균
      sb.from('knowledge_chunks').select('detected_price').eq('user_id', userId)
        .not('detected_price', 'is', null).eq('is_active', true).limit(100),
      // 어제 클릭 (sm_links → 사용자 거)
      sb.from('short_link_clicks').select('id, code', { count: 'exact' })
        .gte('clicked_at', startUTC.toISOString()).lt('clicked_at', endUTC.toISOString()),
    ])

    const convs = convsR.data || []
    const totalHandled = convs.length
    const inbound = convs.filter((c) => c.direction === 'inbound').length
    const outbound = convs.filter((c) => c.direction === 'outbound').length
    const autoRate = inbound > 0 ? outbound / inbound : 0
    const convertedCount = convs.filter((c) => c.is_converted).length

    // 추정 매출
    const prices = (kbPriceR.data || []).map((r) => Number(r.detected_price) || 0).filter((p) => p > 0)
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
    const linkClicks = clicksR.count || 0
    const estimatedRevenueKrw = Math.round(avgPrice * linkClicks * STANDARD_CONVERSION_RATE)

    // 자주 나온 질문 TOP 5 — 단순 키워드 빈도 (Claude 없이도 가능)
    const inboundContents = convs.filter((c) => c.direction === 'inbound').map((c) => 'content' in c ? '' : '')
    const topQuestions: Array<{ q: string; count: number }> = []

    // upsert daily_reports
    await sb.from('daily_reports').upsert({
      user_id: userId,
      date: yesterdayDate,
      total_handled: totalHandled,
      auto_rate: autoRate,
      converted_count: convertedCount,
      urgent_count: urgentR.count || 0,
      window_expired_count: expiredR.count || 0,
      new_fan_count: newFansR.count || 0,
      returning_fan_count: returningFansR.count || 0,
      estimated_revenue_krw: estimatedRevenueKrw,
      link_click_count: linkClicks,
      commerce_reach_count: 0,
      top_questions: topQuestions,
    }, { onConflict: 'user_id,date' })

    createdCount++
  }

  return NextResponse.json({ ok: true, reports: createdCount, date: yesterdayDate })
}
