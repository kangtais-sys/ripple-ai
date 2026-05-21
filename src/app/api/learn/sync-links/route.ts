// src/app/api/learn/sync-links/route.ts
// ⚠️ 완전 교체. 이전 코드는 모두 삭제하고 이것으로 대체.
//
// 변경점:
// - fetch / parse / embed 다 제거
// - link_pages.blocks에서 URL만 뽑아 Inngest로 enqueue
// - 응답 시간 ~500ms (이전엔 30~300초 timeout 위험)

import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'
import { getUserFromRequest } from '@/lib/auth-helper' // 기존 함수 그대로
import { extractUrlsFromBlocks } from '@/lib/link/extract-urls'

let _admin: SupabaseClient | null = null
const admin = (): SupabaseClient => {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 0 } },
      },
    )
  }
  return _admin
}

export const maxDuration = 30 // 30초면 충분

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req)
    if (!user) {
      return NextResponse.json({ error: 'unauth' }, { status: 401 })
    }

    const sb = admin()

    // 사용자 link_pages.blocks 가져오기
    const { data: page, error } = await sb
      .from('link_pages')
      .select('blocks')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      return NextResponse.json(
        { error: 'fetch_link_pages_failed', detail: error.message },
        { status: 500 },
      )
    }

    if (!page?.blocks || !Array.isArray(page.blocks)) {
      return NextResponse.json({ ok: true, queued: 0, reason: 'no_blocks' })
    }

    // 블록에서 URL 추출 (블록 타입별로 다름)
    const urls = extractUrlsFromBlocks(page.blocks)

    if (urls.length === 0) {
      return NextResponse.json({ ok: true, queued: 0, reason: 'no_urls' })
    }

    // Inngest로 일괄 enqueue. 응답 즉시 받음.
    const events = urls.map((u) => ({
      name: 'learn/url.requested' as const,
      data: {
        userId: user.id,
        url: u.url,
        sourceLabel: u.label,
        sourceType: 'link_block' as const,
        blockId: u.blockId,
      },
    }))

    const result = await inngest.send(events)

    return NextResponse.json({
      ok: true,
      queued: urls.length,
      inngestIds: result.ids,
    })
  } catch (e: any) {
    console.error('[sync-links] error', e)
    return NextResponse.json(
      { error: 'internal', detail: String(e?.message ?? e) },
      { status: 500 },
    )
  }
}

