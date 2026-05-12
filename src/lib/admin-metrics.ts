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

export interface AdminMetrics {
  signups: SignupBuckets
  active_users: { dau: number; wau: number; mau: number }
  plans: PlanDistribution
  usage: UsageStats
  mrr_krw: number
  mrr_usd: number
  beta_expiring_7d: number
  marketing: MarketingStats
  link: LinkStats
  cardnews: CardnewsStats
  replies: ReplyStats
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

  // 7) 내 링크 (link_pages + link_page_daily_stats + short_links + short_link_clicks)
  const link: LinkStats = {
    pages_total: 0,
    pages_published: 0,
    authors_count: 0,
    total_views: 0,
    views_7d: 0,
    unique_visitors_7d: 0,
    short_links_total: 0,
    short_link_clicks_total: 0,
    short_link_clicks_7d: 0,
    top_referers: [],
  }
  try {
    const { count: linkTotal } = await sb.from('link_pages').select('id', { count: 'exact', head: true })
    link.pages_total = linkTotal || 0
    const { count: linkPub } = await sb.from('link_pages').select('id', { count: 'exact', head: true }).eq('published', true)
    link.pages_published = linkPub || 0
    const { data: lpRows } = await sb.from('link_pages').select('user_id, view_count')
    const authorSet = new Set<string>()
    for (const r of lpRows || []) {
      if (r.user_id) authorSet.add(r.user_id as string)
      link.total_views += (r.view_count as number) || 0
    }
    link.authors_count = authorSet.size

    const date7dAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data: dailyRows } = await sb
      .from('link_page_daily_stats')
      .select('views, unique_visitors')
      .gte('date', date7dAgo)
    for (const r of dailyRows || []) {
      link.views_7d += (r.views as number) || 0
      link.unique_visitors_7d += (r.unique_visitors as number) || 0
    }

    const { count: slTotal } = await sb.from('short_links').select('code', { count: 'exact', head: true })
    link.short_links_total = slTotal || 0
    const { data: slRows } = await sb.from('short_links').select('click_count')
    for (const r of slRows || []) link.short_link_clicks_total += (r.click_count as number) || 0

    const { count: slc7d } = await sb
      .from('short_link_clicks')
      .select('id', { count: 'exact', head: true })
      .gte('clicked_at', sevenDayAgo)
    link.short_link_clicks_7d = slc7d || 0

    // 유입처 분석 — referer 도메인 추출 (최근 30일)
    const { data: refRows } = await sb
      .from('short_link_clicks')
      .select('referer')
      .gte('clicked_at', thirtyDayAgo)
      .not('referer', 'is', null)
      .limit(5000)
    const refCounts = new Map<string, number>()
    for (const r of refRows || []) {
      const raw = (r.referer as string) || ''
      let source = 'direct'
      if (raw) {
        try {
          const host = new URL(raw).hostname.replace(/^www\./, '')
          // 도메인 별칭 간단 정규화
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
        } catch {
          source = 'unknown'
        }
      }
      refCounts.set(source, (refCounts.get(source) || 0) + 1)
    }
    link.top_referers = Array.from(refCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  } catch {
    // 테이블 누락 시 0 유지
  }

  // 8) 만들기 (card_news_jobs)
  const cardnews: CardnewsStats = {
    jobs_total: 0,
    jobs_published: 0,
    jobs_this_month: 0,
    by_template: [],
  }
  try {
    const { count: cTotal } = await sb.from('card_news_jobs').select('id', { count: 'exact', head: true })
    cardnews.jobs_total = cTotal || 0
    const { count: cPub } = await sb.from('card_news_jobs').select('id', { count: 'exact', head: true }).not('published_at', 'is', null)
    cardnews.jobs_published = cPub || 0
    const { count: cMonth } = await sb
      .from('card_news_jobs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfMonth.toISOString())
    cardnews.jobs_this_month = cMonth || 0

    const { data: tplRows } = await sb.from('card_news_jobs').select('template').not('template', 'is', null)
    const tplMap = new Map<string, number>()
    for (const r of tplRows || []) {
      const t = (r.template as string) || 'unknown'
      tplMap.set(t, (tplMap.get(t) || 0) + 1)
    }
    cardnews.by_template = Array.from(tplMap.entries())
      .map(([template, count]) => ({ template, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  } catch {
    // 카드뉴스 파이프라인 미구현 시 0
  }

  // 9) 자동 응대 (reply_logs)
  const replies: ReplyStats = {
    total: 0,
    this_month_comments: 0,
    this_month_dms: 0,
    by_sentiment: { positive: 0, neutral: 0, negative: 0, unknown: 0 },
    urgent_count: 0,
    approval_rate: 0,
  }
  try {
    const { count: rTotal } = await sb.from('reply_logs').select('id', { count: 'exact', head: true })
    replies.total = rTotal || 0
    // 이번 달 댓글/DM 분리
    const { count: rcMonth } = await sb
      .from('reply_logs')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'comment')
      .gte('created_at', startOfMonth.toISOString())
    replies.this_month_comments = rcMonth || 0
    const { count: rdMonth } = await sb
      .from('reply_logs')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'dm')
      .gte('created_at', startOfMonth.toISOString())
    replies.this_month_dms = rdMonth || 0
    // 감정 분포 (최근 30일)
    const { data: sentRows } = await sb
      .from('reply_logs')
      .select('sentiment, urgency, is_approved')
      .gte('created_at', thirtyDayAgo)
      .limit(5000)
    let approvedCount = 0
    let totalRecent = 0
    for (const r of sentRows || []) {
      totalRecent++
      const s = (r.sentiment as string) || 'unknown'
      if (s === 'positive' || s === 'neutral' || s === 'negative') replies.by_sentiment[s]++
      else replies.by_sentiment.unknown++
      if ((r.urgency as string) === 'urgent' || (r.urgency as string) === 'high') replies.urgent_count++
      if (r.is_approved === true) approvedCount++
    }
    replies.approval_rate = totalRecent > 0 ? Math.round((approvedCount / totalRecent) * 100) : 0
  } catch {
    // 누락 시 0 유지
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
    link,
    cardnews,
    replies,
  }
}
