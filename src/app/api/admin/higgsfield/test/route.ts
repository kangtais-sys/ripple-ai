// Higgsfield 연결 테스트 — 비동기 submit 후 즉시 반환
//
// 흐름:
//   POST /api/admin/higgsfield/test  → submit + marketing_assets row 생성 → 즉시 응답
//   GET  /api/admin/higgsfield/test?asset_id=xxx  → asset 상태 폴링
//   (webhook 으로 완료 시 자동 업데이트)

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { isAdminEmail } from '@/lib/admin'
import { submit, isHiggsfieldConfigured } from '@/lib/higgsfield/client'
import { HF_MODELS } from '@/lib/higgsfield/models'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

async function assertAdmin(req: Request) {
  const u = await getUserFromRequest(req)
  if (!u) return null
  const sb = admin()
  const { data } = await sb.auth.admin.getUserById(u.id)
  if (!data?.user || !isAdminEmail(data.user.email)) return null
  return data.user
}

// POST — 작은 테스트 이미지 1장 비동기 생성
export async function POST(req: NextRequest) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  if (!isHiggsfieldConfigured()) {
    return NextResponse.json({
      ok: false,
      error: 'HIGGSFIELD_AUTH 환경변수 미설정',
    }, { status: 500 })
  }

  const sb = admin()
  const origin = req.nextUrl.origin
  const webhookUrl = `${origin}/api/higgsfield/webhook`

  try {
    // 1) marketing_assets row 만들고 'queued' 상태로
    const { data: asset, error: insErr } = await sb
      .from('marketing_assets')
      .insert({
        type: 'image',
        url: 'pending',
        scene_prompt: 'TEST · minimal Korean coffee shop interior',
        higgsfield_model_id: HF_MODELS.image.soul,
        generation_status: 'queued',
        uploaded_by: u.id,
        tags: ['test'],
      })
      .select('id')
      .single()

    if (insErr || !asset) {
      return NextResponse.json({ ok: false, error: `asset_insert_failed: ${insErr?.message}` }, { status: 500 })
    }

    // 2) Higgsfield submit (webhook 콜백)
    const submitRes = await submit(
      HF_MODELS.image.soul,
      {
        prompt: 'A minimal aesthetic Korean coffee shop interior, soft daylight, editorial photography',
        aspect_ratio: '1:1',
        resolution: '720p',
      },
      webhookUrl
    )

    // 3) request_id 를 asset 에 저장 → webhook 이 이걸로 매칭
    await sb
      .from('marketing_assets')
      .update({
        higgsfield_request_id: submitRes.request_id,
        generation_status: 'processing',
      })
      .eq('id', asset.id)

    return NextResponse.json({
      ok: true,
      asset_id: asset.id,
      request_id: submitRes.request_id,
      note: '제출됨. webhook 으로 30s~2min 후 완료. GET ?asset_id=X 로 폴링.',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// GET ?asset_id=xxx — asset 현재 상태 확인 (frontend 폴링용)
export async function GET(req: NextRequest) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const assetId = req.nextUrl.searchParams.get('asset_id')
  if (!assetId) return NextResponse.json({ error: 'asset_id_required' }, { status: 400 })

  const { data } = await admin()
    .from('marketing_assets')
    .select('id, type, url, generation_status, generation_error, higgsfield_request_id, created_at')
    .eq('id', assetId)
    .single()

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, asset: data })
}
