// POST /api/learn/migrate
//   링크인바이오 마이그레이션 실행 (Linktree/인포크/Beacons 등 → Ssobi)
//
// 흐름:
//   1. 사용자가 /api/learn/url 로 preview 받음 → 확인
//   2. 이 endpoint 호출 → 백그라운드 작업:
//      a. link_pages 신규 row 생성 (handle = user 가 정한 또는 기본)
//      b. preview 의 각 링크 → link_pages.blocks 에 link block 으로 import
//      c. profile (name/bio/avatar) → 페이지 메타에 반영
//      d. 각 외부 URL → /api/learn/url 재호출 (persist=true) → KB 자동 학습
//
// Body: { url, handle?, parseResult: ParseResult }
// Response: { link_page_id, handle, learned_count, blocked_count }

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { quickParse } from '@/lib/parsers/quick'
import { storeKnowledge } from '@/lib/kb/store'
import { extractDomain } from '@/lib/kb/chunker'
import type { ParseResult } from '@/lib/parsers/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HANDLE_RE = /^[a-z0-9_-]{3,30}$/

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function genCode(): string {
  const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]
  return s
}

export async function POST(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    url?: string
    handle?: string
    parseResult?: ParseResult
  }

  const { url, handle: requestedHandle, parseResult } = body
  if (!url || !parseResult || parseResult.type !== 'linkbio') {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }

  const sb = admin()

  // 1) handle 결정 — 요청된 게 있으면 사용, 없으면 IG 핸들 또는 profile name
  let handle = (requestedHandle || '').toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (!HANDLE_RE.test(handle)) {
    // 기본 — IG 연결된 username 시도
    const { data: igAcc } = await sb
      .from('ig_accounts')
      .select('ig_username')
      .eq('user_id', u.id)
      .maybeSingle()
    handle = (igAcc?.ig_username || parseResult.profile?.handle || 'user' + Date.now().toString(36))
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 30)
    if (!HANDLE_RE.test(handle)) handle = 'user' + Date.now().toString(36).slice(0, 8)
  }

  // 2) handle 중복 체크
  const { data: existing } = await sb
    .from('link_pages')
    .select('id, user_id')
    .eq('handle', handle)
    .maybeSingle()
  if (existing && existing.user_id !== u.id) {
    // 자동으로 -2 붙임
    handle = `${handle}-2`
  }

  // 3) ParsedLink[] → link_pages blocks 배열로 변환
  const blocks = (parseResult.links || []).map((l) => ({
    type: 'link',
    title: l.label,
    url: l.url,
    sub: l.sub || undefined,
    code: genCode(),
  }))

  // 4) link_pages upsert
  const heroFromProfile = parseResult.profile ? {
    slides: [{
      title: parseResult.profile.name || '',
      sub: parseResult.profile.bio || '',
      bg: parseResult.profile.avatarUrl ? `url(${parseResult.profile.avatarUrl})` : undefined,
    }],
  } : null

  const { data: existingOwn } = await sb
    .from('link_pages')
    .select('id')
    .eq('user_id', u.id)
    .maybeSingle()

  let linkPageId: string | null = null
  if (existingOwn) {
    // 기존 페이지 있음 → 블록 append (덮어쓰지 않음)
    const { data: cur } = await sb
      .from('link_pages')
      .select('blocks, hero')
      .eq('id', existingOwn.id)
      .single()
    const existingBlocks = Array.isArray(cur?.blocks) ? cur.blocks : []
    await sb
      .from('link_pages')
      .update({
        blocks: [...existingBlocks, ...blocks],
        hero: cur?.hero || heroFromProfile,
        handle,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingOwn.id)
    linkPageId = existingOwn.id
  } else {
    const { data: ins } = await sb
      .from('link_pages')
      .insert({
        user_id: u.id,
        handle,
        hero: heroFromProfile,
        blocks,
        published: true,
      })
      .select('id')
      .single()
    linkPageId = ins?.id || null
  }

  // 5) profiles 동기화
  await sb.from('profiles').update({
    link_handle: handle,
    first_link_added: true,
  }).eq('id', u.id)

  // 6) 백그라운드: 각 외부 URL 자동 학습 (KB 청크 임베딩)
  //    sequentially to avoid rate limit, but with timeout per URL
  let learnedCount = 0
  let blockedCount = 0
  const learnResults: Array<{ url: string; ok: boolean; reason?: string }> = []

  for (const link of (parseResult.links || []).slice(0, 15)) {  // 첫 15개만 자동 학습
    try {
      const domain = extractDomain(link.url) || 'unknown'
      // 정책 캐시 — 봇 차단 알려진 도메인은 skip
      const { data: pol } = await sb
        .from('crawl_policies').select('policy').eq('domain', domain).maybeSingle()
      if (pol?.policy === 'bot_blocked') {
        blockedCount++
        learnResults.push({ url: link.url, ok: false, reason: 'known_bot_blocked' })
        continue
      }

      const parsed = await quickParse(link.url)
      if (parsed.type === 'blocked' || parsed.type === 'image_page') {
        blockedCount++
        learnResults.push({ url: link.url, ok: false, reason: parsed.type })
        continue
      }
      if (parsed.ok && parsed.text) {
        const content = [parsed.title, parsed.description, parsed.text].filter(Boolean).join('\n\n')
        const r = await storeKnowledge(sb, u.id, content, {
          sourceType: 'link_url',
          sourceUrl: link.url,
          sourceLabel: parsed.title || link.label || domain,
        })
        if (r.inserted > 0) learnedCount++
        learnResults.push({ url: link.url, ok: r.inserted > 0 })
      }
    } catch (e) {
      blockedCount++
      learnResults.push({
        url: link.url,
        ok: false,
        reason: e instanceof Error ? e.message : 'error',
      })
    }
  }

  return NextResponse.json({
    ok: true,
    link_page_id: linkPageId,
    handle,
    total_links: parseResult.links?.length || 0,
    learned_count: learnedCount,
    blocked_count: blockedCount,
    results: learnResults,
  })
}
