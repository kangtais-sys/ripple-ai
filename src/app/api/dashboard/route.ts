// 인증: Bearer(앱 localStorage 토큰) 우선 + 쿠키 fallback (getUserFromRequest).
//   이전엔 쿠키 전용이라 이메일 로그인 유저가 401 → 베타 배너 등 미표시.

import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'
import { PLANS, type PlanKey, getUsagePercent, getEffectivePlanKey, isBetaActive } from '@/lib/plans'

export async function GET(req: Request) {
  // 로그인 유저 확인 (Bearer 우선)
  const u = await getUserFromRequest(req)
  if (!u) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = adminClient()

  // 1) profiles 테이블에서 plan + 베타 정보
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, beta, beta_ends_at')
    .eq('id', u.id)
    .single()

  // 베타 기간이면 'premium' 권한 효과
  const plan = getEffectivePlanKey(profile || {}) as PlanKey
  const betaActive = isBetaActive(profile || {})

  // 2) usage_logs에서 이번 달 comment_count, dm_count
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { data: usageLogs } = await supabase
    .from('usage_logs')
    .select('comment_count, dm_count')
    .eq('user_id', u.id)
    .gte('created_at', startOfMonth)

  let comments = 0
  let dms = 0
  if (usageLogs) {
    for (const log of usageLogs) {
      comments += log.comment_count || 0
      dms += log.dm_count || 0
    }
  }

  const total = comments + dms
  const limit = PLANS[plan].limit
  const percent = getUsagePercent(plan, comments, dms)

  // 3) reply_logs에서 최근 10건 응대 내역
  const { data: recentReplies } = await supabase
    .from('reply_logs')
    .select('type, original_text, reply_text, created_at')
    .eq('user_id', u.id)
    .order('created_at', { ascending: false })
    .limit(10)

  // 4) ig_accounts에서 연동된 계정 목록
  const { data: igAccounts } = await supabase
    .from('ig_accounts')
    .select('ig_username')
    .eq('user_id', u.id)

  // ROI 계산: 건당 평균 2분 절약, 시급 15,000원 기준
  const savedMinutes = total * 2
  const savedHours = Math.round(savedMinutes / 60 * 10) / 10
  const savedWon = Math.round(savedMinutes / 60 * 15000)

  return NextResponse.json({
    plan,
    beta: {
      active: betaActive,
      ends_at: profile?.beta_ends_at || null,
    },
    usage: {
      comments,
      dms,
      total,
      limit: limit === Infinity ? -1 : limit,
      percent,
    },
    recentReplies: recentReplies || [],
    igAccounts: igAccounts || [],
    savedHours,
    savedWon,
  })
}
