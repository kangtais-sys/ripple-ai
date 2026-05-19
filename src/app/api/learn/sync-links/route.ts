// POST /api/learn/sync-links
//   사용자 link_pages.blocks 의 모든 URL 을 학습 큐에 적재.
//   학습탭 진입 또는 명시적 trigger 시 호출.
//
// 이전 구조: URL 을 동기로 처리 → Vercel function 500/instance kill.
// 새 구조: learn_queue 에 insert 만 하고 즉시 응답 → cron 이 처리.
//
// Body: {} (인증 헤더만)
// Response: { queued, skipped, alreadyEmbedded, alreadyQueued }

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

type AnyRecord = Record<string, unknown>

export async function POST(req: NextRequest) {
  try {
    const u = await getUserFromRequest(req)
    if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const sb = admin()

    // 1) link_pages.blocks 조회
    const { data: page, error: pageErr } = await sb
      .from('link_pages')
      .select('blocks')
      .eq('user_id', u.id)
      .maybeSingle()

    if (pageErr) {
      console.error('[sync-links] page fetch error:', pageErr)
      return NextResponse.json({ error: 'page_fetch_failed', detail: pageErr.message }, { status: 500 })
    }

    const blocks: AnyRecord[] = Array.isArray(page?.blocks) ? page.blocks : []
    if (blocks.length === 0) {
      return NextResponse.json({ queued: 0, skipped: 0, reason: 'no_blocks' })
    }

    // 2) URL 수집
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

    // 3) dedup
    const seen = new Set<string>()
    const uniqueUrls = allUrls.filter(u => {
      if (seen.has(u.url)) return false
      seen.add(u.url)
      return true
    })

    if (uniqueUrls.length === 0) {
      return NextResponse.json({ queued: 0, skipped: 0, reason: 'no_urls' })
    }

    // 4) 이미 학습된 URL skip
    const urls = uniqueUrls.map(u => u.url)
    const { data: existingChunks } = await sb
      .from('knowledge_chunks')
      .select('source_url')
      .eq('user_id', u.id)
      .eq('is_active', true)
      .in('source_url', urls)
    const alreadyEmbedded = new Set(
      (existingChunks || []).map((c: { source_url: string | null }) => c.source_url).filter(Boolean) as string[]
    )

    // 5) 이미 큐에 pending/processing 인 URL skip
    const { data: existingQueue } = await sb
      .from('learn_queue')
      .select('url')
      .eq('user_id', u.id)
      .in('status', ['pending', 'processing'])
      .in('url', urls)
    const alreadyQueued = new Set(
      (existingQueue || []).map((q: { url: string }) => q.url)
    )

    // 6) 신규 URL → learn_queue insert
    const toQueue = uniqueUrls.filter(u =>
      !alreadyEmbedded.has(u.url) && !alreadyQueued.has(u.url)
    )

    if (toQueue.length === 0) {
      return NextResponse.json({
        queued: 0,
        skipped: alreadyEmbedded.size + alreadyQueued.size,
        alreadyEmbedded: alreadyEmbedded.size,
        alreadyQueued: alreadyQueued.size,
      })
    }

    const insertRows = toQueue.map(item => ({
      user_id: u.id,
      url: item.url,
      label: item.label,
      status: 'pending' as const,
      source: 'sync_links' as const,
    }))

    const { error: insertErr } = await sb
      .from('learn_queue')
      .insert(insertRows)

    if (insertErr) {
      // unique index conflict (race) 발생 시 skip 처리하고 정상 응답
      // 그 외 에러는 진짜 실패
      const isUniqueConflict = insertErr.code === '23505'
      if (!isUniqueConflict) {
        console.error('[sync-links] queue insert failed:', insertErr)
        return NextResponse.json({ error: 'queue_insert_failed', detail: insertErr.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      queued: insertRows.length,
      skipped: alreadyEmbedded.size + alreadyQueued.size,
      alreadyEmbedded: alreadyEmbedded.size,
      alreadyQueued: alreadyQueued.size,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[sync-links] fatal:', msg)
    return NextResponse.json({ error: 'sync_failed', detail: msg }, { status: 500 })
  }
}
