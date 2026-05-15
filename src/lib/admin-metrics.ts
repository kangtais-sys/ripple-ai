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

export interface LinkStats {
  pages_total: number              // 만든 페이지 총 수
  pages_published: number          // 발행된 페이지 수
  authors_count: number            // 실제 만든 유저 수 (unique)
  total_views: number              // 전체 페이지뷰 누적
  views_7d: number                 // 최근 7일 뷰
  unique_visitors_7d: number       // 최근 7일 유니크 방문자
  short_links_total: number        // 숏링크 총 발급 수
  short_link_clicks_total: number  // 숏링크 클릭 총 수
  short_link_clicks_7d: number     // 최근 7일 클릭
  top_referers: Array<{ source: string; count: number }>  // 유입처 TOP 5
}

export interface CardnewsStats {
  jobs_total: number
  jobs_published: number
  jobs_this_month: number
  by_template: Array<{ template: string; count: number }>
}

export interface ReplyStats {
  total: number
  this_month_comments: number
  this_month_dms: number
  by_sentiment: { positive: number; neutral: number; negative: number; unknown: number }
  urgent_count: number
  approval_rate: number       // is_approved=true 비율 (0~100)
}

export interface EssentialMetrics {
  signups: SignupBuckets
  active_users: { dau: number; wau: number; mau: number }
  plans: PlanDistribution
  usage: UsageStats
  mrr_krw: number
  mrr_usd: number
  beta_expiring_7d: number
}

export interface ServiceMetrics {
  link: LinkStats
  cardnews: CardnewsStats
  replies: ReplyStats
}

export interface AdminMetrics extends EssentialMetrics, ServiceMetrics {}

// 필수 메트릭 — 가입자/플랜/MRR/활동 (빠름, ~1s)
export async function getEssentialMetrics(): Promise<EssentialMetrics> {
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
  }
}

// 서비스별 무거운 통계 — 링크/카드뉴스/응대 (느림, ~3~5s)
export async function getServiceMetrics(): Promise<ServiceMetrics> {
  const sb = adminClient()
  const now = new Date()
  const startOfMonth = new Date(now)
  startOfMonth.setDate(now.getDate() - 30)
  const sevenDayAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const thirtyDayAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const link: LinkStats = {
    pages_total: 0, pages_published: 0, authors_count: 0,
    total_views: 0, views_7d: 0, unique_visitors_7d: 0,
    short_links_total: 0, short_link_clicks_total: 0, short_link_clicks_7d: 0,
    top_referers: [],
  }
  const cardnews: CardnewsStats = {
    jobs_total: 0, jobs_published: 0, jobs_this_month: 0, by_template: [],
  }
  const replies: ReplyStats = {
    total: 0, this_month_comments: 0, this_month_dms: 0,
    by_sentiment: { positive: 0, neutral: 0, negative: 0, unknown: 0 },
    urgent_count: 0, approval_rate: 0,
  }
  const date7dAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  try {
    // 모든 쿼리 한 번에 — 4개 sub-system × 다중 쿼리 합쳐서 ~17개 병렬
    const [
      linkTotalRes, linkPubRes, lpRowsRes, dailyRowsRes,
      slTotalRes, slRowsRes, slc7dRes, refRowsRes,
      cTotalRes, cPubRes, cMonthRes, tplRowsRes,
      rTotalRes, rcMonthRes, rdMonthRes, sentRowsRes,
    ] = await Promise.all([
      // 링크
      sb.from('link_pages').select('id', { count: 'exact', head: true }),
      sb.from('link_pages').select('id', { count: 'exact', head: true }).eq('published', true),
      sb.from('link_pages').select('user_id, view_count'),
      sb.from('link_page_daily_stats').select('views, unique_visitors').gte('date', date7dAgo),
      sb.from('short_links').select('code', { count: 'exact', head: true }),
      sb.from('short_links').select('click_count'),
      sb.from('short_link_clicks').select('id', { count: 'exact', head: true }).gte('clicked_at', sevenDayAgo),
      // 유입처 — 30일치 referer (limit 1000 으로 축소, 32만 IG 트래픽 가정에선 충분)
      sb.from('short_link_clicks').select('referer').gte('clicked_at', thirtyDayAgo).not('referer', 'is', null).limit(1000),
      // 카드뉴스
      sb.from('card_news_jobs').select('id', { count: 'exact', head: true }),
      sb.from('card_news_jobs').select('id', { count: 'exact', head: true }).not('published_at', 'is', null),
      sb.from('card_news_jobs').select('id', { count: 'exact', head: true }).gte('created_at', startOfMonth.toISOString()),
      sb.from('card_news_jobs').select('template').not('template', 'is', null).limit(2000),
      // 응대
      sb.from('reply_logs').select('id', { count: 'exact', head: true }),
      sb.from('reply_logs').select('id', { count: 'exact', head: true }).eq('type', 'comment').gte('created_at', startOfMonth.toISOString()),
      sb.from('reply_logs').select('id', { count: 'exact', head: true }).eq('type', 'dm').gte('created_at', startOfMonth.toISOString()),
      sb.from('reply_logs').select('sentiment, urgency, is_approved').gte('created_at', thirtyDayAgo).limit(2000),
    ])

    // 링크 집계
    link.pages_total = linkTotalRes.count || 0
    link.pages_published = linkPubRes.count || 0
    const authorSet = new Set<string>()
    for (const r of lpRowsRes.data || []) {
      if (r.user_id) authorSet.add(r.user_id as string)
      link.total_views += (r.view_count as number) || 0
    }
    link.authors_count = authorSet.size
    for (const r of dailyRowsRes.data || []) {
      link.views_7d += (r.views as number) || 0
      link.unique_visitors_7d += (r.unique_visitors as number) || 0
    }
    link.short_links_total = slTotalRes.count || 0
    for (const r of slRowsRes.data || []) link.short_link_clicks_total += (r.click_count as number) || 0
    link.short_link_clicks_7d = slc7dRes.count || 0

    // 유입처 — referer 도메인 추출
    const refCounts = new Map<string, number>()
    for (const r of refRowsRes.data || []) {
      const raw = (r.referer as string) || ''
      let source = 'direct'
      if (raw) {
        try {
          const host = new URL(raw).hostname.replace(/^www\./, '')
          if (host.includes('instagram')) source = 'instagram'
          else if (host.includes('threads.')) source = 'threads'
          else if (host.includes('tiktok')) source = 'tiktok'
          else if (host.includes('youtube') || host.includes('youtu.be')) source = 'youtube'
          else if (host.includes('facebook') || host === 'fb.com') source = 'facebook'
          else if (host.includes('x.com') || host.includes('twitter.com') || host.includes('t.co')) source = 'x'
          else if (host.includes('kakao')) source = 'kakao'
          else if (host.includes('google')) source = 'google'
          else if (host.includes('naver')) source = 'naver'
          else source = host
        } catch { source = 'unknown' }
      }
      refCounts.set(source, (refCounts.get(source) || 0) + 1)
    }
    link.top_referers = Array.from(refCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    // 카드뉴스 집계
    cardnews.jobs_total = cTotalRes.count || 0
    cardnews.jobs_published = cPubRes.count || 0
    cardnews.jobs_this_month = cMonthRes.count || 0
    const tplMap = new Map<string, number>()
    for (const r of tplRowsRes.data || []) {
      const t = (r.template as string) || 'unknown'
      tplMap.set(t, (tplMap.get(t) || 0) + 1)
    }
    cardnews.by_template = Array.from(tplMap.entries())
      .map(([template, count]) => ({ template, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // 응대 집계
    replies.total = rTotalRes.count || 0
    replies.this_month_comments = rcMonthRes.count || 0
    replies.this_month_dms = rdMonthRes.count || 0
    let approvedCount = 0
    let totalRecent = 0
    for (const r of sentRowsRes.data || []) {
      totalRecent++
      const s = (r.sentiment as string) || 'unknown'
      if (s === 'positive' || s === 'neutral' || s === 'negative') replies.by_sentiment[s]++
      else replies.by_sentiment.unknown++
      if ((r.urgency as string) === 'urgent' || (r.urgency as string) === 'high') replies.urgent_count++
      if (r.is_approved === true) approvedCount++
    }
    replies.approval_rate = totalRecent > 0 ? Math.round((approvedCount / totalRecent) * 100) : 0
  } catch {
    // 일부 테이블 없거나 RLS 차단 — 0 유지
  }

  return { link, cardnews, replies }
}

// 호환용 — 필수 + 서비스 한 번에 (느림)
export async function getAdminMetrics(): Promise<AdminMetrics> {
  const [essential, services] = await Promise.all([getEssentialMetrics(), getServiceMetrics()])
  return { ...essential, ...services }
}
