// GET  /api/link        → 현재 유저의 link_page 조회 (로그인 필요)
// POST /api/link        → 생성/업데이트 (upsert by user_id, handle)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const HANDLE_RE = /^[a-z0-9_-]{3,30}$/

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('link_pages')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ page: data })
}

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

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

  // upsert by user_id (한 유저당 한 페이지)
  const { data, error } = await sb
    .from('link_pages')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 프로필에 핸들 동기화
  await sb.from('profiles').update({ link_handle: body.handle }).eq('id', user.id)

  return NextResponse.json({ page: data })
}
