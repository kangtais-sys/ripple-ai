import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { isAdminEmail } from '@/lib/admin'

export const dynamic = 'force-dynamic'

async function assertAdmin(req: Request) {
  const u = await getUserFromRequest(req)
  if (!u) return null
  const sb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data } = await sb.auth.admin.getUserById(u.id)
  if (!data?.user || !isAdminEmail(data.user.email)) return null
  return data.user
}

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// POST — 샘플 일괄 등록
//   body: { samples: [{ content, source_channel?, notes? }] }
//   또는 단일 추가: { content, ... }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const body = await req.json()
  const items: Array<{ content: string; source_channel?: string; notes?: string }> = Array.isArray(body.samples)
    ? body.samples
    : body.content
    ? [{ content: body.content, source_channel: body.source_channel, notes: body.notes }]
    : []
  const cleaned = items
    .map((s) => ({
      persona_id: id,
      content: (s.content || '').trim(),
      source_channel: s.source_channel || null,
      notes: s.notes || null,
    }))
    .filter((s) => s.content.length > 0)
  if (cleaned.length === 0) return NextResponse.json({ error: 'no_content' }, { status: 400 })

  const { error } = await admin().from('marketing_persona_samples').insert(cleaned)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, inserted: cleaned.length })
}

// DELETE — 샘플 삭제 (?sample_id=xxx)
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const sampleId = req.nextUrl.searchParams.get('sample_id')
  if (!sampleId) return NextResponse.json({ error: 'sample_id_required' }, { status: 400 })
  const { error } = await admin()
    .from('marketing_persona_samples')
    .delete()
    .eq('id', sampleId)
    .eq('persona_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
