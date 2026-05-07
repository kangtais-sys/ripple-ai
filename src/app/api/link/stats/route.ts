// GET /api/link/stats — 현재 유저의 링크 페이지 통계 (조회수 + 일일 + 블록별 클릭)
//
// 응답:
//   {
//     page: { handle, view_count, created_at },
//     daily: [{ date, views, unique_visitors }, ...],  // 최근 30일
//     links: [{ code, label, target_url, click_count, last_click_at }, ...]
//   }

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sb = adminClient()

  // 1) 유저의 link_page
  const { data: page } = await sb
    .from('link_pages')
    .select('id, handle, view_count, created_at, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!page) {
    return NextResponse.json({
      page: null,
      daily: [],
      links: [],
    })
  }

  // 2) 최근 30일 일일 통계
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
  const { data: daily } = await sb
    .from('link_page_daily_stats')
    .select('date, views, unique_visitors')
    .eq('link_page_id', page.id)
    .gte('date', thirtyDaysAgo)
    .order('date', { ascending: false })

  // 3) 본인 short_links — 클릭 카운트 + 최근 클릭 시각
  const { data: links } = await sb
    .from('short_links')
    .select('code, label, target_url, click_count, last_click_at, created_at')
    .eq('user_id', user.id)
    .order('click_count', { ascending: false })
    .limit(50)

  return NextResponse.json({
    page: {
      handle: page.handle,
      view_count: page.view_count || 0,
      created_at: page.created_at,
      updated_at: page.updated_at,
    },
    daily: daily || [],
    links: links || [],
  })
}
