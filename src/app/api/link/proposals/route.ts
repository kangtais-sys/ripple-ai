// GET /api/link/proposals — 본인 링크 페이지로 들어온 제안 목록
//
// FAB 양식 ('쏘비에서 받기' 모드) 으로 들어온 link_proposals 행 반환.
// 키우기 → 실시간 관리 → 협업/제안 탭에서 호출.
//
// 응답: { proposals: [{ id, kind, from_name, from_email, from_handle, message, created_at, seen_at }] }

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()
  // 본인 link_pages 의 id 들
  const { data: pages } = await sb.from('link_pages').select('id').eq('user_id', user.id)
  const ids = (pages || []).map(p => p.id)
  if (ids.length === 0) return NextResponse.json({ proposals: [], unread_count: 0 })

  const { data: proposals } = await sb
    .from('link_proposals')
    .select('id, kind, from_name, from_email, from_handle, message, created_at, read')
    .in('link_page_id', ids)
    .order('created_at', { ascending: false })
    .limit(50)

  const unread_count = (proposals || []).filter(p => !p.read).length

  return NextResponse.json({ proposals: proposals || [], unread_count })
}

// PATCH /api/link/proposals — 미확인 제안 모두 read=true 마킹
export async function PATCH(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()
  const { data: pages } = await sb.from('link_pages').select('id').eq('user_id', user.id)
  const ids = (pages || []).map(p => p.id)
  if (ids.length === 0) return NextResponse.json({ ok: true })

  await sb
    .from('link_proposals')
    .update({ read: true })
    .in('link_page_id', ids)
    .eq('read', false)

  return NextResponse.json({ ok: true })
}
