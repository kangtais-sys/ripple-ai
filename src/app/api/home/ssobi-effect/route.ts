// GET /api/home/ssobi-effect
// 홈 탭 히어로 카드용 — Ssobi가 이번 달 대신 한 일 + 효과
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { calculateSavings, MIN_WAGE_KRW } from '@/lib/pricing'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = adminClient()

  // 이번 달 시작
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  // 1) 이번 달 응대 건수 (type별)
  const { data: replyRows } = await sb
    .from('reply_logs')
    .select('type, created_at, approved_at, send_status')
    .eq('user_id', user.id)
    .gte('created_at', monthStart)

  const replies = replyRows || []
  const comment_count = replies.filter(r => r.type === 'comment' && r.send_status === 'sent').length
  const dm_count = replies.filter(r => r.type === 'dm' && r.send_status === 'sent').length

  // 2) 이번 달 카드뉴스 (생성/예약/게시 모두 포함 — 작성 시간 기준)
  const { data: jobs } = await sb
    .from('card_news_jobs')
    .select('id, status, scheduled_at')
    .eq('user_id', user.id)
    .gte('created_at', monthStart)

  const cardnewsList = jobs || []
  const cardnews_count = cardnewsList.length
  const schedule_count = cardnewsList.filter(j => !!j.scheduled_at || j.status === 'published').length

  // 3) 절약 계산
  const savings = calculateSavings({
    comment: comment_count,
    dm: dm_count,
    cardnews: cardnews_count,
    schedule: schedule_count,
  })

  // 4) 평균 응답 시간 (승인된 응대만)
  const approved = replies.filter(r => r.approved_at && r.created_at)
  let response_avg_seconds: number | null = null
  if (approved.length > 0) {
    const totalSec = approved.reduce((sum, r) => {
      const diff = new Date(r.approved_at!).getTime() - new Date(r.created_at!).getTime()
      return sum + diff / 1000
    }, 0)
    response_avg_seconds = Math.round(totalSec / approved.length)
  }

  // 5) 응대 재방문 (같은 handle이 2번 이상 등장) — 전체 누적 기준
  const { data: allReplies } = await sb
    .from('reply_logs')
    .select('context')
    .eq('user_id', user.id)
    .not('context', 'is', null)

  const handleMap = new Map<string, number>()
  for (const r of (allReplies || [])) {
    const ctx = r.context as { commenter_handle?: string; sender_handle?: string } | null
    const h = ctx?.commenter_handle || ctx?.sender_handle
    if (h) handleMap.set(h, (handleMap.get(h) || 0) + 1)
  }
  const repeat_users = Array.from(handleMap.values()).filter(c => c >= 2).length
  const reply_unique_users = handleMap.size
  const repeat_rate = reply_unique_users > 0 ? repeat_users / reply_unique_users : 0

  // 6) 이번 달 Ssobi 접점 — 댓글·DM 응대 unique + 내 링크 제안자 unique 합산
  //    (내 링크의 link_page_id로 조인해 현재 유저의 페이지로 들어온 제안만)
  const { data: myPages } = await sb
    .from('link_pages').select('id').eq('user_id', user.id)
  const pageIds = (myPages || []).map(p => p.id)

  const { data: monthReplies } = await sb
    .from('reply_logs')
    .select('context')
    .eq('user_id', user.id)
    .gte('created_at', monthStart)
    .not('context', 'is', null)
  const monthHandles = new Set<string>()
  for (const r of (monthReplies || [])) {
    const ctx = r.context as { commenter_handle?: string; sender_handle?: string } | null
    const h = ctx?.commenter_handle || ctx?.sender_handle
    if (h) monthHandles.add(h)
  }

  let link_proposals_count = 0
  const linkSenders = new Set<string>()
  if (pageIds.length) {
    const { data: props } = await sb
      .from('link_proposals')
      .select('from_handle, from_email, from_name, created_at')
      .in('link_page_id', pageIds)
      .gte('created_at', monthStart)
    for (const p of (props || [])) {
      link_proposals_count++
      const key = p.from_handle || p.from_email || p.from_name
      if (key) linkSenders.add(key)
    }
  }

  // 접점 unique = 댓글·DM unique ∪ 링크 제안자 unique
  const contactUnion = new Set<string>([...monthHandles, ...Array.from(linkSenders).map(s => 'link:'+s)])
  const touchpoint_unique_users = contactUnion.size

  // 7) 이번 달 진행률 (날짜 기반)
  const today = now.getDate()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const month_progress_pct = Math.round((today / daysInMonth) * 100)

  return NextResponse.json({
    min_wage_krw: MIN_WAGE_KRW,
    current_month: {
      comment_count,
      dm_count,
      cardnews_count,
      schedule_count,
      total_minutes: savings.totalMinutes,
      total_hours: Math.round(savings.totalHours * 10) / 10,
      total_krw: savings.totalKrw,
      today,
      days_in_month: daysInMonth,
      progress_pct: month_progress_pct,
    },
    response_avg_seconds,
    touchpoint: {
      unique_users: touchpoint_unique_users,
      reply_unique: monthHandles.size,
      link_proposals_count,
      link_senders_unique: linkSenders.size,
    },
    repeat_engagement: {
      total_users: reply_unique_users,
      repeat_users,
      rate: Math.round(repeat_rate * 100) / 100,
    },
  })
}
