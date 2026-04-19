// GET  /api/short           → 내 숏링크 목록 (최신순)
// POST /api/short           → 신규 생성 { target_url, label?, link_page_id? }
// DELETE /api/short?code=xx → 삭제

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const CODE_RE = /^[a-zA-Z0-9]{4,12}$/

function genCode(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('short_links')
    .select('code, target_url, label, click_count, last_click_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ links: data || [] })
}

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    target_url?: string
    label?: string
    link_page_id?: string
    code?: string
  }

  if (!body.target_url || !/^https?:\/\//i.test(body.target_url)) {
    return NextResponse.json({ error: 'target_url 필요 (http/https)' }, { status: 400 })
  }

  // 코드 지정된 경우 유효성 + 중복 체크, 없으면 자동 생성
  let code = body.code
  if (code) {
    if (!CODE_RE.test(code)) return NextResponse.json({ error: 'invalid code' }, { status: 400 })
    const { data: dup } = await sb.from('short_links').select('code').eq('code', code).maybeSingle()
    if (dup) return NextResponse.json({ error: 'code taken' }, { status: 409 })
  } else {
    for (let i = 0; i < 5; i++) {
      const c = genCode()
      const { data: dup } = await sb.from('short_links').select('code').eq('code', c).maybeSingle()
      if (!dup) { code = c; break }
    }
    if (!code) return NextResponse.json({ error: 'failed to generate code' }, { status: 500 })
  }

  const { data, error } = await sb
    .from('short_links')
    .insert({
      code,
      user_id: user.id,
      target_url: body.target_url,
      label: (body.label || '').slice(0, 120) || null,
      link_page_id: body.link_page_id || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ link: data })
}

export async function DELETE(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  if (!code || !CODE_RE.test(code)) return NextResponse.json({ error: 'invalid code' }, { status: 400 })

  const { error } = await sb.from('short_links').delete().eq('code', code).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
