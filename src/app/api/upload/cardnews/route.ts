// POST /api/upload/cardnews
// 카드뉴스 편집 캔버스에서 캡처한 PNG/JPEG 를 Supabase Storage 에 업로드
// Body: multipart/form-data with 'file' + 'job_id' + 'slide'
// 반환: { url, path }
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'

export const maxDuration = 60

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
  // 크기 제한: 이미지 10MB, 영상 100MB (IG 최대 1GB 지만 여기선 빠른 업로드 우선)
  const maxSize = isVideo ? 100 * 1024 * 1024 : 10 * 1024 * 1024
  if (file.size > maxSize) {
    return NextResponse.json({
      error: 'file too large',
      detail: `max ${isVideo ? '100MB (video)' : '10MB (image)'}`
    }, { status: 413 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const contentType = file.type || (isVideo ? 'video/mp4' : 'image/jpeg')
  let ext = 'jpg'
  if (isVideo) ext = contentType.includes('quicktime') ? 'mov' : 'mp4'
  else if (contentType.includes('png')) ext = 'png'
  // 경로: users/{user_id}/jobs/{job_id}/slide-{n}-{timestamp}.{ext}
  const path = `users/${user.id}/jobs/${jobId}/slide-${slide}-${Date.now()}.${ext}`

  const sb = adminClient()
  const { error: upErr } = await sb.storage.from('cardnews').upload(path, buffer, {
    contentType,
    cacheControl: '3600',
    upsert: false,
  })
  if (upErr) {
    console.error('[upload/cardnews] storage error:', upErr)
    return NextResponse.json({ error: 'upload_failed', detail: upErr.message }, { status: 500 })
  }

  const { data: urlData } = sb.storage.from('cardnews').getPublicUrl(path)
  return NextResponse.json({ ok: true, url: urlData.publicUrl, path })
}
