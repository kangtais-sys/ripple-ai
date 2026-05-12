// Higgsfield webhook 수신 — 비동기 생성 결과 처리
//
// Flow:
//   1. Higgsfield 가 완료 시 POST 호출
//   2. body 의 request_id 로 marketing_assets row 찾음
//   3. 결과 URL 의 이미지/영상을 Supabase Storage 로 다운로드
//   4. asset row 의 url, generation_status='completed' 업데이트
//   5. 200 OK 응답 (Higgsfield 가 재전송 안 하게)
//
// 보안: Higgsfield 가 시그니처 검증 미제공 → request_id 유효성으로만 확인

import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { downloadToBuffer } from '@/lib/higgsfield/client'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

const BUCKET = 'marketing-assets'

interface HiggsfieldWebhookPayload {
  status: 'completed' | 'failed' | 'cancelled' | string
  request_id: string
  images?: Array<{ url: string; width?: number; height?: number }>
  video?: { url: string; duration_seconds?: number }
  error?: string
  message?: string
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  let body: HiggsfieldWebhookPayload
  try {
    body = (await req.json()) as HiggsfieldWebhookPayload
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!body.request_id) {
    return NextResponse.json({ error: 'missing_request_id' }, { status: 400 })
  }

  const sb = admin()

  // request_id 로 asset row 찾기
  const { data: asset } = await sb
    .from('marketing_assets')
    .select('id, type, storage_path, higgsfield_request_id, persona_id')
    .eq('higgsfield_request_id', body.request_id)
    .single()

  if (!asset) {
    // 모르는 request 무시 (200 응답 — Higgsfield 가 재전송 안 하게)
    console.warn('[higgsfield/webhook] unknown request_id:', body.request_id)
    return NextResponse.json({ ok: true, note: 'unknown_request_id' })
  }

  // 실패 / 취소
  if (body.status !== 'completed') {
    await sb
      .from('marketing_assets')
      .update({
        generation_status: body.status === 'failed' ? 'failed' : 'cancelled',
        generation_error: body.error || body.message || `status: ${body.status}`,
      })
      .eq('id', asset.id)
    return NextResponse.json({ ok: true })
  }

  // 결과 URL 추출
  const resultUrl = body.images?.[0]?.url || body.video?.url
  if (!resultUrl) {
    await sb
      .from('marketing_assets')
      .update({
        generation_status: 'failed',
        generation_error: 'no_result_url_in_webhook',
      })
      .eq('id', asset.id)
    return NextResponse.json({ ok: true, note: 'no_result_url' })
  }

  // Higgsfield CDN 에서 Supabase Storage 로 옮김 (URL 만료 대비)
  try {
    const { buffer, contentType } = await downloadToBuffer(resultUrl)
    const isVideo = (asset.type as string) === 'video'

    let storedBuffer: Buffer = buffer
    let storedContentType: string = contentType
    let storedExt: string

    if (isVideo) {
      // 영상은 그대로 저장
      storedExt = contentType.includes('quicktime') ? 'mov' : contentType.includes('webm') ? 'webm' : 'mp4'
    } else {
      // 이미지는 WebP 로 재인코딩 (egress 절감)
      try {
        storedBuffer = await sharp(buffer)
          .rotate()
          .webp({ quality: 85 })
          .toBuffer()
        storedContentType = 'image/webp'
        storedExt = 'webp'
      } catch {
        storedExt = contentType.includes('png') ? 'png' : 'jpg'
      }
    }

    // 새 storage path — persona 별 폴더, request_id 가독성
    const folder = (asset.persona_id as string) || 'unassigned'
    const path = `${folder}/${body.request_id.slice(0, 8)}-${Date.now()}.${storedExt}`

    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, storedBuffer, {
      contentType: storedContentType,
      cacheControl: '31536000',
      upsert: false,
    })
    if (upErr) {
      await sb
        .from('marketing_assets')
        .update({
          generation_status: 'failed',
          generation_error: `storage_upload_failed: ${upErr.message}`,
        })
        .eq('id', asset.id)
      return NextResponse.json({ ok: true, note: 'storage_failed' })
    }

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)

    await sb
      .from('marketing_assets')
      .update({
        generation_status: 'completed',
        url: pub.publicUrl,
        storage_path: path,
        mime_type: storedContentType,
      })
      .eq('id', asset.id)

    return NextResponse.json({ ok: true, url: pub.publicUrl })
  } catch (e) {
    await sb
      .from('marketing_assets')
      .update({
        generation_status: 'failed',
        generation_error: `webhook_processing_error: ${e instanceof Error ? e.message : String(e)}`,
      })
      .eq('id', asset.id)
    return NextResponse.json({ ok: true, note: 'processing_failed' })
  }
}
