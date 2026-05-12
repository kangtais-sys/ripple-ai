// POST /api/upload/cardnews
// 카드뉴스 편집 캔버스에서 캡처한 이미지/영상 을 Supabase Storage 에 업로드
//
// 이미지 파이프라인:
//   PNG/JPEG → Sharp 로 WebP q=85 + 최대 1350px 리사이즈 (IG carousel 권장 사이즈)
//   IG/Threads 발행 시 WebP 가 직접 통과되거나 Meta API 가 변환
//
// 영상: 변환 없이 그대로 (mp4/mov)
//
// Body: multipart/form-data with 'file' + 'job_id' + 'slide' + 'media_type'?
// 반환: { url, path, bytes, saved_pct }

import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'
import sharp from 'sharp'

export const maxDuration = 60

const MAX_IMAGE_BYTES = 10 * 1024 * 1024  // 10MB 원본
const MAX_VIDEO_BYTES = 100 * 1024 * 1024 // 100MB
const CARDNEWS_MAX_WIDTH = 1350            // IG carousel 권장 (4:5 비율이면 1080x1350)
const CARDNEWS_WEBP_QUALITY = 85           // 카드뉴스는 텍스트 가독성 중요 → 품질 약간 더 높임

export async function POST(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file')
  const jobId = String(form.get('job_id') || '')
  const slide = String(form.get('slide') || '0')

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  }
  if (!jobId) {
    return NextResponse.json({ error: 'job_id required' }, { status: 400 })
  }

  const mediaType = String(form.get('media_type') || 'image').toLowerCase()
  const isVideo = mediaType === 'video' || (file.type || '').startsWith('video/')
  const maxSize = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
  if (file.size > maxSize) {
    return NextResponse.json({
      error: 'file too large',
      detail: `max ${isVideo ? '100MB (video)' : '10MB (image)'}`
    }, { status: 413 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const inputBuffer = Buffer.from(arrayBuffer)

  // 영상: 변환 없이 그대로 업로드
  if (isVideo) {
    const contentType = file.type || 'video/mp4'
    const ext = contentType.includes('quicktime') ? 'mov' : 'mp4'
    const path = `users/${user.id}/jobs/${jobId}/slide-${slide}-${Date.now()}.${ext}`
    const sb = adminClient()
    const { error: upErr } = await sb.storage.from('cardnews').upload(path, inputBuffer, {
      contentType,
      cacheControl: '31536000',
      upsert: false,
    })
    if (upErr) {
      console.error('[upload/cardnews] storage error:', upErr)
      return NextResponse.json({ error: 'upload_failed', detail: upErr.message }, { status: 500 })
    }
    const { data: urlData } = sb.storage.from('cardnews').getPublicUrl(path)
    return NextResponse.json({ ok: true, url: urlData.publicUrl, path })
  }

  // 이미지: WebP 변환 + 리사이즈
  let webpBuffer: Buffer
  try {
    webpBuffer = await sharp(inputBuffer)
      .rotate()
      .resize({ width: CARDNEWS_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: CARDNEWS_WEBP_QUALITY })
      .toBuffer()
  } catch (e) {
    console.warn('[upload/cardnews] sharp failed', e)
    return NextResponse.json({ error: 'invalid image' }, { status: 400 })
  }

  const path = `users/${user.id}/jobs/${jobId}/slide-${slide}-${Date.now()}.webp`
  const sb = adminClient()
  const { error: upErr } = await sb.storage.from('cardnews').upload(path, webpBuffer, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  })
  if (upErr) {
    console.error('[upload/cardnews] storage error:', upErr)
    return NextResponse.json({ error: 'upload_failed', detail: upErr.message }, { status: 500 })
  }

  const { data: urlData } = sb.storage.from('cardnews').getPublicUrl(path)
  return NextResponse.json({
    ok: true,
    url: urlData.publicUrl,
    path,
    bytes: webpBuffer.length,
    saved_pct: Math.round((1 - webpBuffer.length / file.size) * 100),
  })
}
