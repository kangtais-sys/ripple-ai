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

// GET — 페르소나 + 샘플 + 자산
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await ctx.params

  const sb = admin()
  const [p, s, a] = await Promise.all([
    sb.from('marketing_personas').select('*').eq('id', id).single(),
    sb.from('marketing_persona_samples').select('*').eq('persona_id', id).order('created_at', { ascending: false }),
    sb.from('marketing_assets').select('*').eq('persona_id', id).order('created_at', { ascending: false }),
  ])
  if (p.error) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ persona: p.data, samples: s.data || [], assets: a.data || [] })
}

// PATCH — 페르소나 수정
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const body = await req.json()

  const updates: Record<string, unknown> = {}
  for (const k of ['name', 'language', 'bio', 'voice_description', 'reference_account_url', 'daily_draft_count', 'active']) {
    if (k in body) updates[k] = body[k]
  }
  if ('channels' in body && Array.isArray(body.channels)) updates.channels = body.channels
  if ('topic_pillars' in body && Array.isArray(body.topic_pillars)) updates.topic_pillars = body.topic_pillars

  const { error } = await admin().from('marketing_personas').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — 페르소나 삭제 (cascade 로 samples 삭제, assets 는 SET NULL)
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const { error } = await admin().from('marketing_personas').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
