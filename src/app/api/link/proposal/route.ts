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
    .select('id, user_id')
    .eq('handle', body.handle)
    .eq('published', true)
    .maybeSingle()

  if (!page) return NextResponse.json({ error: 'page not found' }, { status: 404 })

  const validKinds = ['collab', 'ad', 'question', 'other']
  const kind = validKinds.includes(body.kind || '') ? body.kind : 'other'

  // 간단한 IP 해시 (중복 스팸 방지용)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const ipHash = await hashString(ip + (process.env.WEBHOOK_VERIFY_TOKEN || ''))

  const { error, data: proposalInserted } = await admin.from('link_proposals').insert({
    link_page_id: page.id,
    from_name: (body.from_name || '').slice(0, 80),
    from_email: (body.from_email || '').slice(0, 120),
    from_handle: (body.from_handle || '').slice(0, 80),
    message: body.message.slice(0, 2000),
    kind,
    ip_hash: ipHash,
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 내 링크 제안 = 긴급 응대 대기로 reply_logs 에 입력 → "실시간 관리 > 긴급" 탭에서 보이도록
  try {
    const summary = [body.from_name, body.from_email, body.from_handle].filter(Boolean).join(' · ')
    const header = summary ? `[내 링크 제안 · ${kind}] ${summary}\n` : `[내 링크 제안 · ${kind}]\n`
    await admin.from('reply_logs').insert({
      user_id: page.user_id,
      type: 'dm',                          // DM 계열로 통합
      original_text: header + body.message.slice(0, 2000),
      reply_text: '[제안 내용은 내 링크 제안하기 폼을 통해 접수됨. 답변은 이메일로 전송하세요]',
      platform_id: 'link_proposal_' + (proposalInserted?.id || ''),
      urgency: 'urgent',
      sentiment: 'neutral',
      send_status: 'pending',
      is_approved: null,
      context: {
        source: 'link_proposal',
        proposal_id: proposalInserted?.id,
        from_name: body.from_name,
        from_email: body.from_email,
        from_handle: body.from_handle,
        kind,
      },
    })
  } catch (e) { /* 드래프트 생성 실패해도 proposal 저장은 성공 */ }

  return NextResponse.json({ ok: true })
}

async function hashString(s: string) {
  const buf = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('')
}
