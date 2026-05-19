// POST /api/learn/sync-links
//   사용자 link_pages.blocks 의 모든 URL 을 자동 임베딩 (신규만)
//   학습탭 진입 또는 명시적 trigger 시 호출
//
// Body: {} (인증 헤더만)
// Response: { triggered: number, skipped: number }

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 11개 × 평균 5초 + buffer

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
      return NextResponse.json({ triggered: 0, skipped: 0, reason: 'no_blocks' })
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

  // 3) 이미 임베딩된 URL skip
  const uniqueUrls = Array.from(new Set(allUrls.map(u => u.url)))
  let alreadyEmbedded = new Set<string>()
  if (uniqueUrls.length > 0) {
    const { data: existingChunks } = await sb
      .from('knowledge_chunks')
      .select('source_url')
      .eq('user_id', u.id)
      .eq('is_active', true)
      .in('source_url', uniqueUrls)
    alreadyEmbedded = new Set((existingChunks || []).map((c: { source_url: string | null }) => c.source_url).filter(Boolean) as string[])
  }

  const seen = new Set<string>()
  const allToEmbed = allUrls.filter(u => {
    if (alreadyEmbedded.has(u.url)) return false
    if (seen.has(u.url)) return false
    seen.add(u.url)
    return true
  })
  // Vercel function 300s timeout 안에서 한 번에 2개 URL 만 처리 (OCR 포함 안전)
  // 나머지는 client 가 재호출 (response.hasMore)
  const BATCH_SIZE = 2
  const toEmbed = allToEmbed.slice(0, BATCH_SIZE)
  const hasMore = allToEmbed.length > BATCH_SIZE

  // 4) 신규 URL 처리 — quickParse + 본문 이미지 OCR
  const { storeKnowledge } = await import('@/lib/kb/store')
  const { quickParse } = await import('@/lib/parsers/quick')
  const { ocrImages } = await import('@/lib/kb/image-ocr')

  let ok = 0
  let failed = 0
  let ocrCount = 0
  for (const { url, label } of toEmbed) {
    try {
      const parsed = await quickParse(url)
      if (!parsed.ok) {
        failed++
        console.warn('[sync-links] parse failed:', url, parsed.error)
        continue
      }
      // 본문 텍스트 임베딩
      if (parsed.text) {
        const content = [parsed.title, parsed.description, parsed.text].filter(Boolean).join('\n\n')
        await storeKnowledge(sb, u.id, content, {
          sourceType: 'link_url',
          sourceUrl: url,
          sourceLabel: parsed.title || label,
        })
      }
      // 본문 이미지 OCR — Claude Vision
      if (parsed.contentImages && parsed.contentImages.length > 0) {
        const ocrResults = await ocrImages(parsed.contentImages, { concurrency: 4, max: 40 })
        for (const r of ocrResults) {
          if (!r.text) continue
          await storeKnowledge(sb, u.id, r.text, {
            sourceType: 'link_url',
            sourceUrl: url,
            sourceLabel: parsed.title || label,
          })
          ocrCount++
        }
      }
      ok++
    } catch (e) {
      failed++
      console.error('[sync-links] error:', url, e)
    }
  }

    return NextResponse.json({
      triggered: toEmbed.length,
      embedded: ok,
      ocrChunks: ocrCount,
      failed,
      skipped: alreadyEmbedded.size,
      remaining: hasMore ? allToEmbed.length - BATCH_SIZE : 0,
      hasMore,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack : ''
    console.error('[sync-links] fatal:', msg, stack)
    return NextResponse.json({ error: 'sync_failed', detail: msg }, { status: 500 })
  }
}
