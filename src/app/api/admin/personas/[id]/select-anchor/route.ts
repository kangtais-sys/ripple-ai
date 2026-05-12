// POST /api/admin/personas/[id]/select-anchor
//   4장 후보 중 1장을 active anchor 로 지정.
//   - 선택된 asset 의 tags 에 'anchor_active' 추가
//   - 나머지 후보는 tags 에 'anchor_rejected' 추가 (삭제는 안 함, 추후 재선택 가능)

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { isAdminEmail } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const { id: personaId } = await ctx.params
  const body = await req.json()
  const selectedAssetId = body.asset_id as string
  if (!selectedAssetId) return NextResponse.json({ error: 'asset_id_required' }, { status: 400 })

  // 모든 anchor_candidate 가져오기
  const { data: candidates } = await sb
    .from('marketing_assets')
    .select('id, tags')
    .eq('persona_id', personaId)
    .contains('tags', ['anchor_candidate'])

  for (const c of candidates || []) {
    const tags = ((c.tags as string[]) || []).filter((t) => t !== 'anchor_active' && t !== 'anchor_rejected')
    if (c.id === selectedAssetId) tags.push('anchor_active')
    else tags.push('anchor_rejected')
    await sb.from('marketing_assets').update({ tags }).eq('id', c.id)
  }

  return NextResponse.json({ ok: true, selected_asset_id: selectedAssetId })
}
