// POST /api/admin/marketing/generate-now
// 단일 호출 — 오늘 콘텐츠 풀 자동 생성
//
// Body: { persona_id?: string }  — 미지정 시 활성 페르소나 모두

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { isAdminEmail } from '@/lib/admin'
import { generateDailyContent } from '@/lib/marketing-pipeline'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data: ud } = await sb.auth.admin.getUserById(u.id)
  if (!ud?.user || !isAdminEmail(ud.user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: { persona_id?: string } = {}
  try { body = await req.json() } catch {}

  // 대상 페르소나
  let personaIds: string[] = []
  if (body.persona_id) {
    personaIds = [body.persona_id]
  } else {
    const { data } = await sb.from('marketing_personas').select('id').eq('active', true)
    personaIds = (data || []).map((p) => p.id as string)
  }
  if (personaIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_active_personas' }, { status: 400 })
  }

  const origin = req.nextUrl.origin
  const results: Array<unknown> = []
  for (const id of personaIds) {
    try {
      const r = await generateDailyContent(id, origin)
      results.push(r)
    } catch (e) {
      results.push({ persona_id: id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return NextResponse.json({ ok: true, results })
}
