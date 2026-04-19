// POST /api/link/proposal — 방문자가 링크 페이지에 제안 보내기
import { NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    handle?: string
    from_name?: string
    from_email?: string
    from_handle?: string
    message?: string
    kind?: string
  }

  if (!body.handle || !body.message || typeof body.message !== 'string' || body.message.length < 3) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 })
  }

  // service-role 클라이언트 (RLS 우회 — link_proposals insert는 anyone 가능하지만
  // link_page_id FK를 안정적으로 해결하기 위해 서버키 사용)
  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const { data: page } = await admin
    .from('link_pages')
    .select('id')
    .eq('handle', body.handle)
    .eq('published', true)
    .maybeSingle()

  if (!page) return NextResponse.json({ error: 'page not found' }, { status: 404 })

  const validKinds = ['collab', 'ad', 'question', 'other']
  const kind = validKinds.includes(body.kind || '') ? body.kind : 'other'

  // 간단한 IP 해시 (중복 스팸 방지용)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const ipHash = await hashString(ip + (process.env.WEBHOOK_VERIFY_TOKEN || ''))

  const { error } = await admin.from('link_proposals').insert({
    link_page_id: page.id,
    from_name: (body.from_name || '').slice(0, 80),
    from_email: (body.from_email || '').slice(0, 120),
    from_handle: (body.from_handle || '').slice(0, 80),
    message: body.message.slice(0, 2000),
    kind,
    ip_hash: ipHash,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

async function hashString(s: string) {
  const buf = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('')
}
