import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { isAdminEmail } from '@/lib/admin'
import { subscribe, isHiggsfieldConfigured } from '@/lib/higgsfield/client'
import { HF_MODELS } from '@/lib/higgsfield/models'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Higgsfield 연결 테스트 — admin 만, 소형 이미지 1장 생성 후 URL 반환
// 비용: ~$0.025 (수 페니)

export async function POST(req: NextRequest) {
  // admin 인증
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

  // env 체크
  if (!isHiggsfieldConfigured()) {
    return NextResponse.json({
      ok: false,
      stage: 'env',
      error: 'HIGGSFIELD_AUTH 환경변수 미설정. Vercel env 확인.',
    }, { status: 500 })
  }

  // 작은 테스트 이미지 1장 생성
  try {
    const t0 = Date.now()
    const result = await subscribe(
      HF_MODELS.image.soul,
      {
        prompt: 'A minimal aesthetic Korean coffee shop interior, soft daylight, editorial photography',
        aspect_ratio: '1:1',
        resolution: '720p',
      },
      { pollIntervalMs: 2000, maxWaitMs: 50000 }
    )
    const elapsed = Date.now() - t0

    if (result.status !== 'completed') {
      return NextResponse.json({
        ok: false,
        stage: 'generation',
        status: result.status,
        error: result.error || result.message,
        elapsed_ms: elapsed,
      })
    }

    return NextResponse.json({
      ok: true,
      elapsed_ms: elapsed,
      image_url: result.images?.[0]?.url,
      model: HF_MODELS.image.soul,
      request_id: result.request_id,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({
      ok: false,
      stage: 'api_call',
      error: msg,
    }, { status: 500 })
  }
}
