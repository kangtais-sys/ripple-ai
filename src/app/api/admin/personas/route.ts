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

// GET — 페르소나 목록 (샘플·자산 count 포함)
export async function GET(req: NextRequest) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const sb = admin()
  const { data: personas } = await sb
    .from('marketing_personas')
    .select('*')
    .order('created_at', { ascending: true })

  // 각 페르소나의 샘플·자산 카운트 일괄 조회
  const ids = (personas || []).map((p) => p.id as string)
  const [sampleCounts, assetCounts, draftCounts] = await Promise.all([
    ids.length > 0 ? sb.from('marketing_persona_samples').select('persona_id').in('persona_id', ids) : { data: [] },
    ids.length > 0 ? sb.from('marketing_assets').select('persona_id').in('persona_id', ids) : { data: [] },
    ids.length > 0 ? sb.from('marketing_posts').select('persona_id').in('persona_id', ids).eq('status', 'draft') : { data: [] },
  ])
  const tally = (rows: { persona_id?: string | null }[] | null) => {
    const m = new Map<string, number>()
    for (const r of rows || []) {
      if (!r.persona_id) continue
      m.set(r.persona_id, (m.get(r.persona_id) || 0) + 1)
    }
    return m
  }
  const sM = tally(sampleCounts.data as { persona_id?: string }[])
  const aM = tally(assetCounts.data as { persona_id?: string }[])
  const dM = tally(draftCounts.data as { persona_id?: string }[])

  const result = (personas || []).map((p) => ({
    ...p,
    sample_count: sM.get(p.id as string) || 0,
    asset_count: aM.get(p.id as string) || 0,
    draft_count: dM.get(p.id as string) || 0,
  }))
  return NextResponse.json({ personas: result })
}

// POST — 페르소나 생성
export async function POST(req: NextRequest) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json()
  const name: string = (body.name || '').trim()
  const language: string = body.language || 'ko'
  const voice_description: string = (body.voice_description || '').trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  if (!voice_description) return NextResponse.json({ error: 'voice_description_required' }, { status: 400 })

  const { data, error } = await admin()
    .from('marketing_personas')
    .insert({
      name,
      language,
      bio: body.bio || null,
      voice_description,
      reference_account_url: body.reference_account_url || null,
      channels: Array.isArray(body.channels) ? body.channels : [],
      topic_pillars: Array.isArray(body.topic_pillars) ? body.topic_pillars : [],
      daily_draft_count: typeof body.daily_draft_count === 'number' ? body.daily_draft_count : 3,
      active: body.active !== false,
      created_by: u.id,
    })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}
