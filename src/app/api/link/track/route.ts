// POST /api/link/track — 공개 링크 페이지 조회수 +1 (클라이언트 사이드 호출)
//
// page.tsx 가 ISR 캐싱되면 SSR 렌더링이 60초마다 한 번만 실행돼서 view_count 가
// 부정확. 그래서 트래킹은 별도 엔드포인트로 분리 → 클라이언트 마운트 시 항상 호출.
//
// Body: { handle: 'yuminhye' }
// 응답: { ok: true } (실패해도 페이지는 정상 표시되니까 noisy 안 함)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { handle?: string }
    if (!body.handle) return NextResponse.json({ ok: false, reason: 'no handle' }, { status: 400 })

    const sb = adminClient()
    const { data: page } = await sb
      .from('link_pages')
      .select('id')
      .eq('handle', body.handle)
      .eq('published', true)
      .maybeSingle()
    if (!page) return NextResponse.json({ ok: false, reason: 'not found' }, { status: 404 })

    const dateKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    // atomic RPC (migration 015)
    const r1 = await sb.rpc('increment_link_view', { p_id: page.id })
    const r2 = await sb.rpc('increment_link_day_view', { p_id: page.id, p_date: dateKst })
    if (!r1.error && !r2.error) return NextResponse.json({ ok: true })

    // Fallback (race-prone) — RPC 미존재 환경 대비
    const { data: cur } = await sb.from('link_pages').select('view_count').eq('id', page.id).maybeSingle()
    await sb.from('link_pages').update({ view_count: ((cur?.view_count as number) || 0) + 1 }).eq('id', page.id)
    return NextResponse.json({ ok: true, fallback: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
