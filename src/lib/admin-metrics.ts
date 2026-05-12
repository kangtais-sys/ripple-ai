// 백오피스 메트릭 — 서버측 집계 헬퍼
// service role key 로 모든 테이블 SELECT (RLS 우회)

import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export interface SignupBuckets {
  today: number
  week: number
  month: number
  total: number
}

export interface PlanDistribution {
  free: number
  basic: number
  premium: number
  business: number
  beta_active: number
}

export interface UsageStats {
  monthly_comments: number
  monthly_dms: number
  monthly_total: number
}

export interface MarketingStats {
  pending: number
  published_30d: number
  failed_30d: number
}

export interface AdminMetrics {
  signups: SignupBuckets
  active_users: { dau: number; wau: number; mau: number }
  plans: PlanDistribution
  usage: UsageStats
  mrr_krw: number
  mrr_usd: number
  beta_expiring_7d: number
  marketing: MarketingStats
}

export async function getAdminMetrics(): Promise<AdminMetrics> {
  const sb = adminClient()

  const now = new Date()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - 7)
  const startOfMonth = new Date(now)
  startOfMonth.setDate(now.getDate() - 30)
  const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  // 1) 가입자 카운트
  const [totalRes, todayRes, weekRes, monthRes] = await Promise.all([
    sb.from('profiles').select('id', { count: 'exact', head: true }),
    sb.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', startOfDay.toISOString()),
    sb.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', startOfWeek.toISOString()),
    sb.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', startOfMonth.toISOString()),
  ])
  const signups: SignupBuckets = {
    today: todayRes.count || 0,
    week: weekRes.count || 0,
    month: monthRes.count || 0,
    total: totalRes.count || 0,
  }

  // 2) 플랜 분포 (profiles.plan 그룹)
  const { data: planRows } = await sb.from('profiles').select('plan, beta, beta_ends_at')
  const plans: PlanDistribution = {
    free: 0,
    basic: 0,
    premium: 0,
    business: 0,
    beta_active: 0,
  }
  let betaExpiring7d = 0
  for (const row of planRows || []) {
    const planKey = (row.plan || 'free') as keyof Omit<PlanDistribution, 'beta_active'>
    if (planKey in plans) plans[planKey] += 1
    if (row.beta && row.beta_ends_at) {
      const ends = new Date(row.beta_ends_at).getTime()
      if (ends > now.getTime()) {
        plans.beta_active += 1
        if (ends <= in7d.getTime()) betaExpiring7d += 1
      }
    }
  }

  // 3) DAU/WAU/MAU — reply_logs 의 unique user_id (활동 지표로 사용)
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const sevenDayAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const thirtyDayAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [dauRes, wauRes, mauRes] = await Promise.all([
    sb.from('reply_logs').select('user_id').gte('created_at', oneDayAgo),
    sb.from('reply_logs').select('user_id').gte('created_at', sevenDayAgo),
    sb.from('reply_logs').select('user_id').gte('created_at', thirtyDayAgo),
  ])
  const active_users = {
    dau: new Set((dauRes.data || []).map((r) => r.user_id)).size,
    wau: new Set((wauRes.data || []).map((r) => r.user_id)).size,
    mau: new Set((mauRes.data || []).map((r) => r.user_id)).size,
  }

  // 4) 이번 달 사용량 합산
  const monthStr = now.toISOString().slice(0, 7)
  const { data: usageRows } = await sb
    .from('usage_logs')
    .select('comment_count, dm_count')
    .eq('month', monthStr)
  let monthlyComments = 0
  let monthlyDms = 0
  for (const u of usageRows || []) {
    monthlyComments += u.comment_count || 0
    monthlyDms += u.dm_count || 0
  }

  // 5) MRR (active 구독자 합산) — 베타 제외, plan 별 가격
  //   migration 017 미적용 시 currency/monthly_price_usd 컬럼 없을 수 있어 try/catch
  let mrrKrw = 0
  let mrrUsd = 0
  try {
    const { data: subRows } = await sb
      .from('subscriptions')
      .select('plan, currency, monthly_price_krw, monthly_price_usd')
      .eq('status', 'active')
      .neq('plan', 'free')
    for (const s of subRows || []) {
      if (s.currency === 'USD' && s.monthly_price_usd) mrrUsd += Number(s.monthly_price_usd)
      else if (s.monthly_price_krw) mrrKrw += s.monthly_price_krw
    }
  } catch {
    // migration 017 미적용 — KRW 만 집계 fallback
    try {
      const { data: subRows } = await sb
        .from('subscriptions')
        .select('plan, monthly_price_krw')
        .eq('status', 'active')
        .neq('plan', 'free')
      for (const s of subRows || []) {
        if (s.monthly_price_krw) mrrKrw += s.monthly_price_krw
      }
    } catch {
      // 둘 다 실패 — 0 유지
    }
  }

  // 6) 마케팅 발행 통계 (marketing_posts 테이블 — Phase 1.5 마지막 작업에서 생성될 예정)
  const marketing: MarketingStats = { pending: 0, published_30d: 0, failed_30d: 0 }
  try {
    const [pendingRes, publishedRes, failedRes] = await Promise.all([
      sb.from('marketing_posts').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('marketing_posts').select('id', { count: 'exact', head: true }).eq('status', 'published').gte('published_at', thirtyDayAgo),
      sb.from('marketing_posts').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('published_at', thirtyDayAgo),
    ])
    marketing.pending = pendingRes.count || 0
    marketing.published_30d = publishedRes.count || 0
    marketing.failed_30d = failedRes.count || 0
  } catch {
    // 테이블 없을 수 있음 (migration 미실행) — 0 으로
  }

  return {
    signups,
    active_users,
    plans,
    usage: {
      monthly_comments: monthlyComments,
      monthly_dms: monthlyDms,
      monthly_total: monthlyComments + monthlyDms,
    },
    mrr_krw: mrrKrw,
    mrr_usd: mrrUsd,
    beta_expiring_7d: betaExpiring7d,
    marketing,
  }
}
