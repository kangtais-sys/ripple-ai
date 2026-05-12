// POST /api/link/upload-image — link 에디터 이미지 업로드 (Supabase Storage)
//
// 업로드 파이프라인:
//   1. multipart 수신 (최대 10MB 원본)
//   2. Sharp 로 자동 변환 — WebP q=80 + 최대 1600px 리사이즈
//   3. Supabase Storage 에 .webp 저장 (PNG/JPG 1MB → WebP 100KB, 10배 절감)
//   4. URL 반환 (DB 저장은 호출자)
//
// FormData: file (Blob), kind (hero|grid|magazine|... 폴더 분류)
// 응답: { url: 'https://.../storage/v1/object/public/link-images/{userId}/{kind}/{ts}.webp' }

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import sharp from 'sharp'

export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_INPUT_BYTES = 10 * 1024 * 1024 // 원본 10MB (변환 전)
const MAX_WIDTH = 1600                    // 1600px 리사이즈 (모바일 retina 까지 커버)
const WEBP_QUALITY = 80

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const fd = await req.formData().catch(() => null)
  if (!fd) return NextResponse.json({ error: 'invalid form' }, { status: 400 })

  const file = fd.get('file') as File | null
  const kind = (fd.get('kind') as string) || 'img'
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'no file' }, { status: 400 })
  if (file.size > MAX_INPUT_BYTES) return NextResponse.json({ error: 'file too large (max 10MB)' }, { status: 413 })
  if (!/^image\//.test(file.type)) return NextResponse.json({ error: 'not an image' }, { status: 400 })

  // Sharp 변환 — WebP + 리사이즈
  let webpBuffer: Buffer
  try {
    const arrayBuf = await file.arrayBuffer()
    const inputBuf = Buffer.from(arrayBuf)
    webpBuffer = await sharp(inputBuf)
      .rotate()                                              // EXIF orientation 자동 보정
      .resize({ width: MAX_WIDTH, withoutEnlargement: true }) // 가로 1600 초과 시만 축소
      .webp({ quality: WEBP_QUALITY })
      .toBuffer()
  } catch (e) {
    console.warn('[upload-image] sharp convert failed', e)
    return NextResponse.json({ error: 'invalid image' }, { status: 400 })
  }

  const sb = adminClient()
  const safeKind = kind.replace(/[^a-z0-9_-]/gi, '').slice(0, 20) || 'img'
  const path = `${user.id}/${safeKind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`

  const { error } = await sb.storage.from('link-images').upload(path, webpBuffer, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) {
    console.warn('[upload-image] storage error', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: pub } = sb.storage.from('link-images').getPublicUrl(path)
  return NextResponse.json({
    url: pub.publicUrl,
    path,
    bytes: webpBuffer.length,
    saved_pct: Math.round((1 - webpBuffer.length / file.size) * 100),
  })
}
