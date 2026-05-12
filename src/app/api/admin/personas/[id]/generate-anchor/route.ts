// POST /api/admin/personas/[id]/generate-anchor
//   페르소나 캐릭터 anchor 후보 4장을 Higgsfield 로 비동기 생성
//   - 각 candidate 는 marketing_assets row 로 등록 (tag='anchor_candidate')
//   - webhook 으로 결과 도착 → asset.url 업데이트
//   - 클라이언트는 4개 asset_id 받아 폴링

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { isAdminEmail } from '@/lib/admin'
import { submit, isHiggsfieldConfigured } from '@/lib/higgsfield/client'
import { HF_MODELS } from '@/lib/higgsfield/models'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CHARACTER_ANCHOR_PROMPT_TEMPLATE = `Editorial portrait photography. Korean female AI persona named Ssobi, late 20s, modern minimalist aesthetic. {pose}. Natural soft daylight, neutral palette (ivory, olive, charcoal). K-beauty natural makeup with subtle glow. Confident but warm expression. Editorial fashion magazine quality. Clean simple background. Sharp focus, shallow depth of field. Shot on Hasselblad H6D, 80mm lens.`

const POSES = [
  'Looking directly at camera, slight smile, professional headshot',
  'Three-quarter view, looking off-camera thoughtfully, relaxed pose',
  'Casual environment portrait, at minimal modern desk with laptop',
  'Soft natural smile, holding coffee cup, lifestyle moment',
]

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

  if (!isHiggsfieldConfigured()) {
    return NextResponse.json({ error: 'HIGGSFIELD_AUTH 미설정' }, { status: 500 })
  }

  const { id: personaId } = await ctx.params
  const { data: persona } = await sb
    .from('marketing_personas')
    .select('id, name')
    .eq('id', personaId)
    .single()
  if (!persona) return NextResponse.json({ error: 'persona_not_found' }, { status: 404 })

  const origin = req.nextUrl.origin
  const webhookUrl = `${origin}/api/higgsfield/webhook`

  const assetIds: string[] = []
  const errors: string[] = []

  for (let i = 0; i < POSES.length; i++) {
    const pose = POSES[i]
    const prompt = CHARACTER_ANCHOR_PROMPT_TEMPLATE.replace('{pose}', pose)

    try {
      // asset row 먼저 등록 (queued)
      const { data: asset } = await sb
        .from('marketing_assets')
        .insert({
          persona_id: personaId,
          type: 'image',
          url: 'pending',
          scene_prompt: prompt,
          higgsfield_model_id: HF_MODELS.image.soul,
          generation_status: 'queued',
          tags: ['anchor_candidate', `pose_${i + 1}`],
          uploaded_by: u.id,
        })
        .select('id')
        .single()
      if (!asset) {
        errors.push(`pose ${i + 1}: asset_insert_failed`)
        continue
      }

      // Higgsfield submit
      const submitRes = await submit(
        HF_MODELS.image.soul,
        {
          prompt,
          aspect_ratio: '1:1',  // 정사각 (anchor 는 다용도)
          resolution: '1080p',
        },
        webhookUrl
      )

      await sb
        .from('marketing_assets')
        .update({
          higgsfield_request_id: submitRes.request_id,
          generation_status: 'processing',
        })
        .eq('id', asset.id)

      assetIds.push(asset.id as string)
    } catch (e) {
      errors.push(`pose ${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return NextResponse.json({
    ok: assetIds.length > 0,
    asset_ids: assetIds,
    errors,
    note: '비동기. 30s~5min 후 webhook 으로 완성. GET /api/admin/assets?persona_id=X 로 상태 확인.',
  })
}
