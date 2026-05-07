// GET  /api/link        → 현재 유저의 link_page 조회 (로그인 필요)
// POST /api/link        → 생성/업데이트 (upsert by user_id, handle)
//
// 2026-05-07 fix: Bearer 토큰 인증 추가 (이전엔 cookie 만 사용 → Supabase JS CDN
//   localStorage 세션 유저는 항상 401 → 편집해도 link_pages 행이 절대 안 생김)
//   getUserFromRequest 가 Bearer 우선 + cookie fallback 둘 다 처리

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'

const HANDLE_RE = /^[a-z0-9_-]{3,30}$/

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sb = adminClient()  // Bearer/cookie 인증 통과 — RLS 우회 OK

  const { data, error } = await sb
    .from('link_pages')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ page: data })
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sb = adminClient()

  const body = await req.json().catch(() => ({})) as {
    handle?: string
    hero?: unknown
    theme?: unknown
    settings?: unknown
    blocks?: unknown
    published?: boolean
  }

  if (!body.handle || !HANDLE_RE.test(body.handle)) {
    return NextResponse.json({ error: 'invalid handle (3~30 영문 소문자/숫자/-_)' }, { status: 400 })
  }

  // handle 중복 체크 (다른 유저가 선점했는지)
  const { data: dup } = await sb
    .from('link_pages')
    .select('user_id')
    .eq('handle', body.handle)
    .maybeSingle()
  if (dup && dup.user_id !== user.id) {
    return NextResponse.json({ error: 'handle already taken' }, { status: 409 })
  }

  const payload = {
    user_id: user.id,
    handle: body.handle,
    hero: body.hero ?? {},
    theme: body.theme ?? {},
    settings: body.settings ?? {},
    blocks: body.blocks ?? [],
    published: body.published ?? true,
  }

  // 2026-05-07 fix: link_pages.user_id 에 UNIQUE 제약 없어서 onConflict:'user_id' 가 500 에러
  //   manual upsert: 기존 행 있으면 UPDATE, 없으면 INSERT
  const { data: existing } = await sb
    .from('link_pages')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  let data: Record<string, unknown> | null = null
  let error: { message: string } | null = null
  if (existing) {
    const r = await sb
      .from('link_pages')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single()
    data = r.data; error = r.error
  } else {
    const r = await sb
      .from('link_pages')
      .insert(payload)
      .select()
      .single()
    data = r.data; error = r.error
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 프로필에 핸들 동기화
  await sb.from('profiles').update({ link_handle: body.handle }).eq('id', user.id)

  return NextResponse.json({ page: data })
}
