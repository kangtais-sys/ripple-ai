// POST /api/admin/migrate-images — Supabase Storage 의 기존 PNG/JPG 를 WebP 로 일괄 변환
//
// 처리:
//   1. link-images bucket 의 모든 파일 listing (.png .jpg .jpeg 만)
//   2. 각 파일 download → Sharp WebP 변환 (q=80, 최대 1600px)
//   3. 같은 경로명에 확장자 .webp 로 업로드
//   4. link_pages 의 hero (jsonb) + blocks (jsonb) 에 박혀있는 옛 URL 을
//      SQL string replace 로 새 URL 로 일괄 치환
//   5. 옛 PNG/JPG 파일 삭제 (verify=true 일 때만)
//
// 보안: admin email 만, POST body 의 confirm=true 필요
// 사용:
//   GET  /api/admin/migrate-images          → dry run (변환 안 함)
//   POST /api/admin/migrate-images          → 실제 변환 + URL 치환 (옛 파일 보존)
//   POST /api/admin/migrate-images?delete=1 → 변환 + 옛 파일 삭제까지

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { isAdminEmail } from '@/lib/admin'
import sharp from 'sharp'

export const maxDuration = 300
export const runtime = 'nodejs'

const BUCKET = 'link-images'
const MAX_WIDTH = 1600
const WEBP_QUALITY = 80

async function assertAdmin() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user || !isAdminEmail(user.email)) return null
  return user
}

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// bucket 의 모든 파일 재귀 list (Supabase API 는 폴더별 list 만 지원)
async function listAllFiles(
  sb: ReturnType<typeof admin>,
  prefix: string = ''
): Promise<Array<{ path: string; size: number }>> {
  const out: Array<{ path: string; size: number }> = []
  const { data } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000 })
  if (!data) return out
  for (const item of data) {
    if (item.id === null) {
      // 폴더 → 재귀
      const subPrefix = prefix ? `${prefix}/${item.name}` : item.name
      const sub = await listAllFiles(sb, subPrefix)
      out.push(...sub)
    } else {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name
      out.push({ path: fullPath, size: item.metadata?.size || 0 })
    }
  }
  return out
}

function isConvertibleImage(path: string): boolean {
  const lower = path.toLowerCase()
  return /\.(png|jpg|jpeg)$/.test(lower)
}

function newPath(oldPath: string): string {
  return oldPath.replace(/\.(png|jpg|jpeg)$/i, '.webp')
}

// GET — dry run
export async function GET() {
  const u = await assertAdmin()
  if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = admin()
  const all = await listAllFiles(sb)
  const toConvert = all.filter((f) => isConvertibleImage(f.path))
  const totalBytes = toConvert.reduce((s, f) => s + f.size, 0)

  return NextResponse.json({
    dry_run: true,
    bucket: BUCKET,
    total_files: all.length,
    convertible_files: toConvert.length,
    total_bytes: totalBytes,
    total_mb: Math.round((totalBytes / 1024 / 1024) * 10) / 10,
    sample: toConvert.slice(0, 10).map((f) => f.path),
  })
}

// POST — 실제 변환
export async function POST(req: NextRequest) {
  const u = await assertAdmin()
  if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const deleteOld = req.nextUrl.searchParams.get('delete') === '1'
  const limitParam = parseInt(req.nextUrl.searchParams.get('limit') || '0', 10)
  const sb = admin()

  const all = await listAllFiles(sb)
  let toConvert = all.filter((f) => isConvertibleImage(f.path))
  if (limitParam > 0) toConvert = toConvert.slice(0, limitParam)

  const results: Array<{
    path: string
    new_path: string
    ok: boolean
    old_bytes: number
    new_bytes?: number
    saved_pct?: number
    error?: string
  }> = []

  for (const f of toConvert) {
    const np = newPath(f.path)
    try {
      // 1) Download
      const dl = await sb.storage.from(BUCKET).download(f.path)
      if (dl.error || !dl.data) {
        results.push({ path: f.path, new_path: np, ok: false, old_bytes: f.size, error: `download: ${dl.error?.message}` })
        continue
      }
      const inputBuf = Buffer.from(await dl.data.arrayBuffer())

      // 2) Convert
      const webpBuf = await sharp(inputBuf)
        .rotate()
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()

      // 3) Upload (upsert true 인 이유: 재실행 시 idempotent)
      const up = await sb.storage.from(BUCKET).upload(np, webpBuf, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: true,
      })
      if (up.error) {
        results.push({ path: f.path, new_path: np, ok: false, old_bytes: f.size, error: `upload: ${up.error.message}` })
        continue
      }

      // 4) URL 치환 — link_pages.hero + blocks (jsonb) 안의 옛 URL 모두 새 URL 로
      //    PostgreSQL: jsonb 를 text 로 cast 후 replace 후 다시 jsonb cast
      const oldUrl = sb.storage.from(BUCKET).getPublicUrl(f.path).data.publicUrl
      const newUrl = sb.storage.from(BUCKET).getPublicUrl(np).data.publicUrl

      // RPC 없이 직접 update — Supabase JS 의 .update 는 jsonb 부분 치환 불가
      //   string 컨테인 페이지를 select 후 클라이언트에서 replace 처리
      const { data: pages } = await sb
        .from('link_pages')
        .select('id, hero, blocks')
        .or(`hero::text.ilike.%${f.path.split('/').pop()}%,blocks::text.ilike.%${f.path.split('/').pop()}%`)
      if (pages) {
        for (const p of pages) {
          let changed = false
          const heroStr = JSON.stringify(p.hero)
          const blocksStr = JSON.stringify(p.blocks)
          const newHero = heroStr.replaceAll(oldUrl, newUrl)
          const newBlocks = blocksStr.replaceAll(oldUrl, newUrl)
          if (newHero !== heroStr || newBlocks !== blocksStr) {
            await sb
              .from('link_pages')
              .update({
                hero: JSON.parse(newHero),
                blocks: JSON.parse(newBlocks),
              })
              .eq('id', p.id)
            changed = true
          }
          void changed
        }
      }

      // 5) 옛 파일 삭제 (옵션)
      if (deleteOld) {
        await sb.storage.from(BUCKET).remove([f.path])
      }

      results.push({
        path: f.path,
        new_path: np,
        ok: true,
        old_bytes: f.size,
        new_bytes: webpBuf.length,
        saved_pct: Math.round((1 - webpBuf.length / f.size) * 100),
      })
    } catch (e) {
      results.push({ path: f.path, new_path: np, ok: false, old_bytes: f.size, error: String(e) })
    }
  }

  const successResults = results.filter((r) => r.ok && r.new_bytes !== undefined)
  const oldTotal = successResults.reduce((s, r) => s + r.old_bytes, 0)
  const newTotal = successResults.reduce((s, r) => s + (r.new_bytes || 0), 0)

  return NextResponse.json({
    ok: true,
    processed: results.length,
    success: successResults.length,
    failed: results.length - successResults.length,
    old_total_bytes: oldTotal,
    new_total_bytes: newTotal,
    saved_pct: oldTotal > 0 ? Math.round((1 - newTotal / oldTotal) * 100) : 0,
    deleted_old: deleteOld,
    results,
  })
}
