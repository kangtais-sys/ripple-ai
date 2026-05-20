// GET /api/home/dashboard
//   홈 탭 통합 fetch — Day 1 vs ROI 분기 + 사용자 유형 별 카피
//
// 반환:
// - mode: 'day1' | 'roi'
// - user_type: seller | creator | educator | mixed
// - yesterday: { headline_value, headline_label, click_count, reply_count }
// - week: { returning_fans, new_fans }
// - lifetime: { days, total_replies, est_revenue_krw, total_clicks }
// - signals: { reply_mode, draft_mode_until, has_kb, has_ig, link_handle }

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

export async function GET(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = admin()
  const now = new Date()

  // 어제 (KST) 범위
  const yKST = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  yKST.setUTCDate(yKST.getUTCDate() - 1)
  const yesterdayDate = yKST.toISOString().slice(0, 10)

  // 7일 전
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [profR, igR, kbCountR, yesterdayR, weekFansR, lifetimeR, lifetimeRev] = await Promise.all([
    sb.from('profiles')
      .select('user_type, reply_mode, draft_mode_until, link_handle, created_at')
      .eq('id', u.id).maybeSingle(),
    sb.from('ig_accounts').select('ig_username').eq('user_id', u.id).limit(1).maybeSingle(),
    sb.from('knowledge_chunks').select('id', { count: 'exact', head: true })
      .eq('user_id', u.id).eq('is_active', true),
    sb.from('daily_reports').select('*').eq('user_id', u.id).eq('date', yesterdayDate).maybeSingle(),
    sb.from('fan_profiles').select('first_seen_at, last_seen_at')
      .eq('user_id', u.id).gte('last_seen_at', weekAgo).limit(500),
    sb.from('conversations').select('id', { count: 'exact', head: true })
      .eq('user_id', u.id).eq('direction', 'outbound'),
    sb.from('daily_reports').select('estimated_revenue_krw, link_click_count')
      .eq('user_id', u.id).limit(365),
  ])

  const profile = profR.data
  const igUsername = igR.data?.ig_username
  const hasKB = (kbCountR.count || 0) > 0
  const hasIG = !!igUsername

  // 누적 (lifetime)
  const accountDays = profile?.created_at
    ? Math.max(1, Math.floor((now.getTime() - new Date(profile.created_at as string).getTime()) / (24 * 60 * 60 * 1000)))
    : 1
  const totalReplies = lifetimeR.count || 0
  const estRevenueLifetime = (lifetimeRev.data || []).reduce((s, r) => s + (r.estimated_revenue_krw || 0), 0)
  const totalClicks = (lifetimeRev.data || []).reduce((s, r) => s + (r.link_click_count || 0), 0)

  // 어제 결과
  const y = yesterdayR.data
  let yesterdayHeadlineValue = 0
  let yesterdayHeadlineLabel = '응대 완료'
  let yesterdayHeadlineUnit = '건'
  if (y) {
    const userType = (profile?.user_type || 'mixed') as string
    if (userType === 'seller') {
      yesterdayHeadlineValue = y.estimated_revenue_krw || 0
      yesterdayHeadlineLabel = '매출이 늘었어요'
      yesterdayHeadlineUnit = 'KRW'
    } else if (userType === 'creator') {
      yesterdayHeadlineValue = y.new_fan_count || 0
      yesterdayHeadlineLabel = '새로운 팬이 생겼어요'
      yesterdayHeadlineUnit = '명'
    } else if (userType === 'educator') {
      yesterdayHeadlineValue = y.commerce_reach_count || y.link_click_count || 0
      yesterdayHeadlineLabel = '강의 페이지를 봤어요'
      yesterdayHeadlineUnit = '명'
    } else {
      yesterdayHeadlineValue = y.total_handled || 0
      yesterdayHeadlineLabel = '응대 완료'
      yesterdayHeadlineUnit = '건'
    }
  }

  // 7일 팬 활동
  const weekFans = weekFansR.data || []
  const weekAgoTs = new Date(weekAgo).getTime()
  const newFansCount = weekFans.filter((f) => new Date(f.first_seen_at as string).getTime() >= weekAgoTs).length
  const returningFansCount = weekFans.length - newFansCount

  // 모드 결정 — 첫날 onboarding 3단계 (IG 연동 / KB 등록 / 내 링크 핸들 설정)
  //   모두 완료 시 실데이터(roi) 모드. 어제 daily_report 없어도 진입 가능
  //   (첫날엔 당연히 어제 데이터 없음).
  const hasLinkHandle = !!profile?.link_handle
  const mode = (hasIG && hasKB && hasLinkHandle) ? 'roi' : 'day1'

  return NextResponse.json({
    mode,
    user_type: profile?.user_type || 'mixed',
    ig_username: igUsername || null,
    link_handle: profile?.link_handle || null,
    yesterday: y ? {
      headline_value: yesterdayHeadlineValue,
      headline_label: yesterdayHeadlineLabel,
      headline_unit: yesterdayHeadlineUnit,
      click_count: y.link_click_count || 0,
      reply_count: y.total_handled || 0,
      urgent_count: y.urgent_count || 0,
    } : null,
    week: {
      returning_fans: returningFansCount,
      new_fans: newFansCount,
    },
    lifetime: {
      days: accountDays,
      total_replies: totalReplies,
      est_revenue_krw: estRevenueLifetime,
      total_clicks: totalClicks,
    },
    signals: {
      reply_mode: profile?.reply_mode || 'draft',
      draft_mode_until: profile?.draft_mode_until || null,
      has_kb: hasKB,
      has_ig: hasIG,
    },
  })
}
