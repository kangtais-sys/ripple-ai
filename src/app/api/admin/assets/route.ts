import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { isAdminEmail } from '@/lib/admin'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

const BUCKET = 'marketing-assets'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024   // 10MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024  // 100MB
const IMAGE_MAX_WIDTH = 1600
const IMAGE_WEBP_QUALITY = 85

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

// GET — 자산 목록 (?persona_id=xxx&type=image)
export async function GET(req: NextRequest) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const personaId = req.nextUrl.searchParams.get('persona_id')
  const type = req.nextUrl.searchParams.get('type')
  let q = admin().from('marketing_assets').select('*').order('created_at', { ascending: false })
  if (personaId) q = q.eq('persona_id', personaId)
  if (type) q = q.eq('type', type)
  const { data, error } = await q.limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assets: data || [] })
}

// POST — 자산 업로드 (multipart/form-data)
//   file: Blob
//   persona_id: UUID (선택)
//   scene_prompt: string (선택)
//   tags: comma 구분 (선택)
export async function POST(req: NextRequest) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'invalid_form' }, { status: 400 })
  const file = form.get('file')
  if (!file || !(file instanceof File)) return NextResponse.json({ error: 'file_required' }, { status: 400 })

  const personaId = (form.get('persona_id') as string) || null
  const scenePrompt = (form.get('scene_prompt') as string) || null
  const tagsRaw = (form.get('tags') as string) || ''
  const tags = tagsRaw.split(',').map((s) => s.trim()).filter(Boolean)

  const isImage = file.type.startsWith('image/')
  const isVideo = file.type.startsWith('video/')
  if (!isImage && !isVideo) return NextResponse.json({ error: 'unsupported_type' }, { status: 400 })

  const maxSize = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
  if (file.size > maxSize) {
    return NextResponse.json({
      error: 'file_too_large',
      detail: `max ${isVideo ? '100MB' : '10MB'}`,
    }, { status: 413 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const sb = admin()

  let uploadBuffer: Buffer
  let contentType: string
  let ext: string
  let width: number | undefined
  let height: number | undefined

  if (isImage) {
    try {
      const sharpInst = sharp(Buffer.from(arrayBuffer))
      const meta = await sharpInst.metadata()
      width = meta.width
      height = meta.height
      uploadBuffer = await sharpInst
        .rotate()
        .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: IMAGE_WEBP_QUALITY })
        .toBuffer()
      contentType = 'image/webp'
      ext = 'webp'
    } catch {
      return NextResponse.json({ error: 'invalid_image' }, { status: 400 })
    }
  } else {
    uploadBuffer = Buffer.from(arrayBuffer)
    contentType = file.type || 'video/mp4'
    ext = contentType.includes('quicktime') ? 'mov' : contentType.includes('webm') ? 'webm' : 'mp4'
  }

  const folder = personaId || 'unassigned'
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, uploadBuffer, {
    contentType,
    cacheControl: '31536000',
    upsert: false,
  })
  if (upErr) return NextResponse.json({ error: 'upload_failed', detail: upErr.message }, { status: 500 })

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)

  const { data, error } = await sb
    .from('marketing_assets')
    .insert({
      persona_id: personaId,
      type: isVideo ? 'video' : 'image',
      url: pub.publicUrl,
      storage_path: path,
      mime_type: contentType,
      width,
      height,
      scene_prompt: scenePrompt,
      tags,
      uploaded_by: u.id,
    })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, id: data.id, url: pub.publicUrl, bytes: uploadBuffer.length })
}

// DELETE — 자산 삭제 (?asset_id=xxx)
export async function DELETE(req: NextRequest) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const assetId = req.nextUrl.searchParams.get('asset_id')
  if (!assetId) return NextResponse.json({ error: 'asset_id_required' }, { status: 400 })

  const sb = admin()
  // Storage 파일도 같이 정리
  const { data: row } = await sb
    .from('marketing_assets')
    .select('storage_path')
    .eq('id', assetId)
    .single()
  if (row?.storage_path) await sb.storage.from(BUCKET).remove([row.storage_path as string])
  const { error } = await sb.from('marketing_assets').delete().eq('id', assetId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
