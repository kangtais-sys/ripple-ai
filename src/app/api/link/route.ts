// GET  /api/link        → 현재 유저의 link_page 조회 (로그인 필요)
// POST /api/link        → 생성/업데이트 (upsert by user_id, handle)
//
// 2026-05-07 fix: Bearer 토큰 인증 추가 (이전엔 cookie 만 사용 → Supabase JS CDN
//   localStorage 세션 유저는 항상 401 → 편집해도 link_pages 행이 절대 안 생김)
//   getUserFromRequest 가 Bearer 우선 + cookie fallback 둘 다 처리

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'

const HANDLE_RE = /^[a-z0-9_-]{3,30}$/

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sb = adminClient()  // Bearer/cookie 인증 통과 — RLS 우회 OK

  const { data, error } = await sb
    .from('link_pages')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ page: data })
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sb = adminClient()

  const body = await req.json().catch(() => ({})) as {
    handle?: string
    hero?: unknown
    theme?: unknown
    settings?: unknown
    blocks?: unknown
    published?: boolean
  }

  if (!body.handle || !HANDLE_RE.test(body.handle)) {
    return NextResponse.json({ error: 'invalid handle (3~30 영문 소문자/숫자/-_)' }, { status: 400 })
  }

  // handle 중복 체크 (다른 유저가 선점했는지)
  const { data: dup } = await sb
    .from('link_pages')
    .select('user_id')
    .eq('handle', body.handle)
    .maybeSingle()
  if (dup && dup.user_id !== user.id) {
    return NextResponse.json({ error: 'handle already taken' }, { status: 409 })
  }

  // 2026-05-07: URL 있는 블록 (link/image/event/countdown/bigbanner/contact/magazine/quicklinks)
  //   에 short_link code 자동 부여 → SSR 가 /s/{code} 로 라우팅 → 클릭 통계 기록 가능
  const blocks = await ensureShortLinkCodes(sb, user.id, Array.isArray(body.blocks) ? body.blocks : [])

  const payload = {
    user_id: user.id,
    handle: body.handle,
    hero: body.hero ?? {},
    theme: body.theme ?? {},
    settings: body.settings ?? {},
    blocks: blocks,
    published: body.published ?? true,
  }

  // 2026-05-07 fix: link_pages.user_id 에 UNIQUE 제약 없어서 onConflict:'user_id' 가 500 에러
  //   manual upsert: 기존 행 있으면 UPDATE, 없으면 INSERT
  const { data: existing } = await sb
    .from('link_pages')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  let data: Record<string, unknown> | null = null
  let error: { message: string } | null = null
  if (existing) {
    const r = await sb
      .from('link_pages')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single()
    data = r.data; error = r.error
  } else {
    const r = await sb
      .from('link_pages')
      .insert(payload)
      .select()
      .single()
    data = r.data; error = r.error
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 프로필에 핸들 동기화
  await sb.from('profiles').update({ link_handle: body.handle }).eq('id', user.id)

  // ISR 캐시 무효화 — 저장 직후 /u/[handle] 페이지 캐시 비움 → 다음 방문은 새 데이터
  try { revalidatePath('/u/' + body.handle) } catch (_) {}

  // 백그라운드 KB 학습 — 링크 블록 텍스트 + 외부 URL 자동 임베딩
  //   await 안 해도 됨 (fire-and-forget, 응답 빠르게 반환)
  embedLinkBlocksBackground(sb, user.id, blocks).catch((e) => {
    console.error('[/api/link] background KB embed failed:', e)
  })

  return NextResponse.json({ page: data })
}

// 백그라운드 KB 임베딩 — 링크 블록의 텍스트 + 외부 URL 자동 학습
// 신규 URL 만 처리 (knowledge_chunks 에 이미 있는 URL skip — 비용 절감)
async function embedLinkBlocksBackground(sb: SupabaseClient, userId: string, blocks: AnyRecord[]): Promise<void> {
  const { storeKnowledge } = await import('@/lib/kb/store')
  const { quickParse } = await import('@/lib/parsers/quick')

  // 1) 모든 URL 수집 (단일 블록 + items 배열)
  type UrlEntry = { url: string; label: string }
  const allUrls: UrlEntry[] = []
  for (const block of blocks) {
    const url = typeof block.url === 'string' ? block.url : ''
    if (url && /^https?:\/\//.test(url)) {
      allUrls.push({ url, label: (block.title as string) || (block.label as string) || 'external link' })
    }
    if (Array.isArray(block.items)) {
      for (const item of block.items as AnyRecord[]) {
        const iu = typeof item.url === 'string' ? item.url : ''
        if (iu && /^https?:\/\//.test(iu)) {
          allUrls.push({ url: iu, label: (item.title as string) || (item.label as string) || 'external link' })
        }
      }
    }
  }

  // 2) 이미 임베딩된 URL 조회 — skip 대상
  const uniqueUrls = Array.from(new Set(allUrls.map(u => u.url)))
  let alreadyEmbedded = new Set<string>()
  if (uniqueUrls.length > 0) {
    const { data: existingChunks } = await sb
      .from('knowledge_chunks')
      .select('source_url')
      .eq('user_id', userId)
      .eq('is_active', true)
      .in('source_url', uniqueUrls)
    alreadyEmbedded = new Set((existingChunks || []).map((c: { source_url: string | null }) => c.source_url).filter(Boolean) as string[])
  }

  // 3) block 자체 텍스트 임베딩 — url 있으면 같이 저장해 외부 URL chunks 와 통합
  //    (없으면 source_url=null 로 저장하지만, 가능한 url 매칭으로 dedup)
  for (const block of blocks) {
    const blockText = ['title', 'sub', 'text', 'desc', 'caption']
      .map((k) => (typeof block[k] === 'string' ? block[k] : ''))
      .filter(Boolean)
      .join('\n')
    if (blockText.length > 30) {
      const blockUrl = typeof block.url === 'string' && /^https?:\/\//.test(block.url) ? block.url : undefined
      try {
        await storeKnowledge(sb, userId, blockText, {
          sourceType: 'link',
          sourceUrl: blockUrl,
          sourceLabel: (block.title as string) || (block.label as string) || (block.type as string) || 'link block',
        })
      } catch (e) {
        console.error('[embedLinkBlocks] block text failed:', e)
      }
    }
  }

  // 4) 신규 URL 만 외부 임베딩 (병렬 — 단, 너무 많으면 throttle)
  const toEmbed = allUrls.filter(u => !alreadyEmbedded.has(u.url))
  // 중복 제거 (같은 URL 여러 블록)
  const seen = new Set<string>()
  const dedup = toEmbed.filter(u => { if (seen.has(u.url)) return false; seen.add(u.url); return true })
  console.log(`[embedLinkBlocks] ${dedup.length} new urls to embed (skip ${alreadyEmbedded.size})`)
  for (const { url, label } of dedup) {
    try {
      const parsed = await quickParse(url)
      if (parsed.ok && parsed.text) {
        const content = [parsed.title, parsed.description, parsed.text].filter(Boolean).join('\n\n')
        await storeKnowledge(sb, userId, content, {
          sourceType: 'link_url',
          sourceUrl: url,
          sourceLabel: parsed.title || label,
        })
        console.log(`[embedLinkBlocks] embedded: ${url}`)
      } else {
        console.warn(`[embedLinkBlocks] parse failed: ${url}`, parsed.error || 'no text')
      }
    } catch (e) {
      console.error('[embedLinkBlocks] url failed:', url, e)
    }
  }
}

// 6자리 영숫자 코드 생성
function genCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}

type AnyRecord = Record<string, unknown>
// adminClient() 의 반환 타입과 맞추기 위해 SupabaseClient 직접 import
import type { SupabaseClient } from '@supabase/supabase-js'

// URL 있는 블록에 short_link code 부여 + short_links 테이블 upsert
//   클릭 통계 기록을 위해 SSR 가 /s/{code} 로 라우팅하게 함
async function ensureShortLinkCodes(sb: SupabaseClient, userId: string, blocks: AnyRecord[]): Promise<AnyRecord[]> {
  const out: AnyRecord[] = []
  for (const b of blocks) {
    const block = { ...b }
    // URL 가진 메인 블록 — code 부여
    const url = typeof block.url === 'string' ? block.url : ''
    const hasUrl = url && /^https?:\/\//.test(url)
    if (hasUrl && !block.code) {
      block.code = genCode()
    }
    if (block.code && hasUrl) {
      await upsertShortLink(sb, userId, block.code as string, url, (block.title as string) || (block.label as string) || (block.text as string) || '')
    }
    // quicklinks/grid items 도 각자 code
    if (Array.isArray(block.items)) {
      block.items = await Promise.all((block.items as AnyRecord[]).map(async (it) => {
        const item = { ...it }
        const itemUrl = typeof item.url === 'string' ? item.url : ''
        const itemHasUrl = itemUrl && /^https?:\/\//.test(itemUrl)
        if (itemHasUrl && !item.code) item.code = genCode()
        if (item.code && itemHasUrl) {
          await upsertShortLink(sb, userId, item.code as string, itemUrl, (item.label as string) || (item.title as string) || '')
        }
        return item
      }))
    }
    out.push(block)
  }
  return out
}

async function upsertShortLink(sb: SupabaseClient, userId: string, code: string, targetUrl: string, label: string) {
  // upsert: 같은 code 있으면 target_url·label 업데이트, 없으면 insert
  const { data: existing } = await sb
    .from('short_links')
    .select('code')
    .eq('code', code)
    .maybeSingle()
  if (existing) {
    await sb.from('short_links')
      .update({ target_url: targetUrl, label: label || null })
      .eq('code', code)
  } else {
    await sb.from('short_links').insert({
      code,
      user_id: userId,
      target_url: targetUrl,
      label: label || null,
    })
  }
}
