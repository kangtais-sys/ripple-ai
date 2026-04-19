// GET /api/link/check?handle=xxx
// 핸들 사용 가능 여부 (중복/유효성)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const HANDLE_RE = /^[a-z0-9_-]{3,30}$/
const RESERVED = new Set([
  'admin', 'api', 'app', 'www', 'mail', 'root', 'help',
  'ssobi', 'login', 'signup', 'auth', 'support', 'settings',
  'u', 's', 'me', 'home', 'about', 'terms', 'privacy',
])

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const handle = (searchParams.get('handle') || '').toLowerCase().trim()

  if (!HANDLE_RE.test(handle)) {
    return NextResponse.json({ ok: false, reason: 'invalid' })
  }
  if (RESERVED.has(handle)) {
    return NextResponse.json({ ok: false, reason: 'reserved' })
  }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()

  const { data, error } = await sb
    .from('link_pages')
    .select('user_id')
    .eq('handle', handle)
    .maybeSingle()

  if (error) return NextResponse.json({ ok: false, reason: 'error' }, { status: 500 })

  // 내가 이미 쓰고 있는 핸들이면 ok (본인 페이지)
  if (!data) return NextResponse.json({ ok: true })
  if (user && data.user_id === user.id) return NextResponse.json({ ok: true, own: true })
  return NextResponse.json({ ok: false, reason: 'taken' })
}
