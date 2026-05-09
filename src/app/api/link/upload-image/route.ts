// POST /api/link/upload-image — link 에디터 이미지 업로드 (Supabase Storage)
//
// base64 인라인은 page payload 부풀리고 SSR 응답이 7MB+ 로 나가서 사용자가 14초씩
// 기다림 → 이탈. Storage 에 올려두고 URL 만 DB 에 저장하면 HTML 50KB 로 줄고
// 이미지는 CDN 에서 병렬·캐시.
//
// FormData: file (Blob), kind (hero|grid|magazine|... 폴더 분류)
// 응답: { url: 'https://.../storage/v1/object/public/link-images/{userId}/{kind}/{ts}.jpg' }

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'

export const runtime = 'nodejs'

const MAX_BYTES = 5 * 1024 * 1024 // 5MB

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const fd = await req.formData().catch(() => null)
  if (!fd) return NextResponse.json({ error: 'invalid form' }, { status: 400 })

  const file = fd.get('file') as File | null
  const kind = (fd.get('kind') as string) || 'img'
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'no file' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (max 5MB)' }, { status: 413 })
  if (!/^image\//.test(file.type)) return NextResponse.json({ error: 'not an image' }, { status: 400 })

  const sb = adminClient()
  const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '')
  const safeKind = kind.replace(/[^a-z0-9_-]/gi, '').slice(0, 20) || 'img'
  const path = `${user.id}/${safeKind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await sb.storage.from('link-images').upload(path, file, {
    contentType: file.type,
    cacheControl: '31536000', // 1년 — 한 번 업로드한 이미지는 안 바뀜 (Date.now path 로 cache-bust)
    upsert: false,
  })
  if (error) {
    console.warn('[upload-image] storage error', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: pub } = sb.storage.from('link-images').getPublicUrl(path)
  return NextResponse.json({ url: pub.publicUrl, path })
}
