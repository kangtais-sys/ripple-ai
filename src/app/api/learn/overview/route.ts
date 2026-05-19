// GET /api/learn/overview
//   학습 탭 데이터 통합 fetch — 한 번에 모든 카드 정보
//
// 반환:
// - tone: { learned_style, persona_summary, user_corrections, validation_completed_at }
// - products: 자동 학습된 source_url 별로 group → 가격·라벨·상태
// - files: uploaded_files
// - urgent: 활성 긴급 공지
// - user_type: 자동 분류된 유형

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = admin()
  const now = new Date().toISOString()

  // 병렬 fetch
  const [toneR, profR, chunksR, filesR, urgentR, igR, linkR, queueR] = await Promise.all([
    sb.from('tone_profiles')
      .select('learned_style, persona_summary, persona_details, user_corrections, validation_completed_at')
      .eq('user_id', u.id)
      .maybeSingle(),
    sb.from('profiles')
      .select('user_type, user_type_manual, reply_mode, draft_mode_until, created_at')
      .eq('id', u.id)
      .maybeSingle(),
    sb.from('knowledge_chunks')
      .select('id, source_type, source_label, source_url, source_domain, detected_price, detected_currency, category, content, created_at')
      .eq('user_id', u.id)
      .eq('is_active', true)
      .in('source_type', ['link', 'link_url', 'pdf', 'docx', 'csv', 'image', 'manual', 'migration'])
      .order('created_at', { ascending: false })
      .limit(500),
    sb.from('uploaded_files')
      .select('id, file_name, file_type, file_size_bytes, status, chunk_count, created_at')
      .eq('user_id', u.id)
      .order('created_at', { ascending: false })
      .limit(50),
    sb.from('urgent_contexts')
      .select('id, content, expires_at, created_at')
      .eq('user_id', u.id)
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('created_at', { ascending: false }),
    sb.from('ig_accounts')
      .select('ig_username')
      .eq('user_id', u.id)
      .limit(1)
      .maybeSingle(),
    sb.from('link_pages')
      .select('blocks, handle')
      .eq('user_id', u.id)
      .maybeSingle(),
    sb.from('learn_queue')
      .select('id, url, label, status, last_error, result, created_at, updated_at')
      .eq('user_id', u.id)
      .in('status', ['pending', 'processing', 'blocked', 'failed'])
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  // ─── link_pages 블록 = 카드 기준 ───
  // chunks (knowledge_chunks) 는 카드에 attach (chunk_count) 만 함.
  // 한 카드에 같은 제품이 두 번 안 나오게 함.
  function normalizeLabel(s: string | null | undefined): string {
    if (!s) return ''
    return s
      .replace(/<[^>]*>/g, '')           // HTML 태그 제거
      .replace(/[\s\u00A0]+/g, ' ')      // 공백 압축
      .toLowerCase()
      .trim()
  }
  const productMap = new Map<string, {
    source_url: string
    source_label: string
    source_domain: string | null
    category: string | null
    price: number | null
    currency: string | null
    chunk_count: number
    content_preview: string
  }>()
  // URL → productMap key
  const urlToKey = new Map<string, string>()
  // normalizedLabel → productMap key
  const labelToKey = new Map<string, string>()

  // ─── 1) link_pages 블록 → 카드 (메인 기준) ───
  type LinkLike = { url: string; title?: string; kind?: string; price?: string }
  function extractBlockLinks(block: Record<string, unknown>): LinkLike[] {
    const out: LinkLike[] = []
    if (!block) return out
    const type = String(block.type || '')
    const url = typeof block.url === 'string' ? block.url : ''
    const title = (block.title || block.text || block.label || '') as string
    if (['link', 'event', 'bigbanner'].includes(type) && url) {
      out.push({ url, title: title || url, kind: type })
    }
    if (['grid', 'quicklinks', 'socials'].includes(type) && Array.isArray(block.items)) {
      for (const it of block.items as Record<string, unknown>[]) {
        const itUrl = typeof it?.url === 'string' ? it.url : ''
        if (!itUrl) continue
        out.push({
          url: itUrl,
          title: String(it.title || it.label || itUrl),
          kind: String(it.kind || type),
          price: typeof it.price === 'string' ? it.price : undefined,
        })
      }
    }
    return out
  }

  const linkBlocks = Array.isArray(linkR.data?.blocks) ? linkR.data.blocks : []
  for (const blk of linkBlocks as Record<string, unknown>[]) {
    for (const link of extractBlockLinks(blk)) {
      // 블록 자체가 카드. URL/label 기준 dedup.
      const key = link.url
      if (productMap.has(key)) continue
      let domain: string | null = null
      try { domain = new URL(link.url).hostname.replace(/^www\./, '') } catch {}
      productMap.set(key, {
        source_url: link.url,
        source_label: link.title || link.url,
        source_domain: domain,
        category: link.kind === 'product' ? 'product' : null,
        price: null,
        currency: null,
        chunk_count: 0,
        content_preview: '',
      })
      urlToKey.set(link.url, key)
      const norm = normalizeLabel(link.title)
      if (norm) labelToKey.set(norm, key)
    }
  }

  // ─── 2) knowledge_chunks → 매칭 카드에 attach ───
  // chunks 의 source_url 매치 또는 (URL 없으면) normalizedLabel 매치 → chunk_count++
  // 매치 안 되는 chunks 는 별도 카드 (사용자가 직접 학습시킨 외부 URL)
  for (const c of chunksR.data || []) {
    // 우선 source_url 매치
    if (c.source_url && urlToKey.has(c.source_url)) {
      const key = urlToKey.get(c.source_url)!
      const entry = productMap.get(key)!
      entry.chunk_count++
      if (c.detected_price && !entry.price) entry.price = c.detected_price
      if (!entry.content_preview) entry.content_preview = (c.content || '').slice(0, 100)
      continue
    }
    // 다음 label 매치 (block 텍스트 임베딩 chunks)
    const norm = normalizeLabel(c.source_label)
    if (norm && labelToKey.has(norm)) {
      const key = labelToKey.get(norm)!
      const entry = productMap.get(key)!
      entry.chunk_count++
      if (c.detected_price && !entry.price) entry.price = c.detected_price
      if (!entry.content_preview) entry.content_preview = (c.content || '').slice(0, 100)
      continue
    }
    // 매치 안 됨 → 별도 카드 (사용자가 직접 학습시킨 외부 자료)
    const key = c.source_url || c.source_label || c.id
    if (!productMap.has(key)) {
      productMap.set(key, {
        source_url: c.source_url || '',
        source_label: c.source_label || c.source_url || c.id,
        source_domain: c.source_domain,
        category: c.category,
        price: c.detected_price,
        currency: c.detected_currency,
        chunk_count: 0,
        content_preview: (c.content || '').slice(0, 100),
      })
      if (c.source_url) urlToKey.set(c.source_url, key)
      if (norm) labelToKey.set(norm, key)
    }
    const entry = productMap.get(key)!
    entry.chunk_count++
    if (c.detected_price && !entry.price) entry.price = c.detected_price
  }

  const products = Array.from(productMap.values()).sort((a, b) => {
    // 가격 있는 거 먼저, 그 다음 청크 수 많은 거
    if (a.price && !b.price) return -1
    if (!a.price && b.price) return 1
    return b.chunk_count - a.chunk_count
  })

  // 큐 항목 — 학습탭 UI 에 처리 상태 표시용
  const queue = (queueR.data || []).map((q: {
    id: string
    url: string
    label: string | null
    status: string
    last_error: string | null
    result: Record<string, unknown> | null
    created_at: string
    updated_at: string
  }) => ({
    id: q.id,
    url: q.url,
    label: q.label || q.url,
    status: q.status,           // pending | processing | blocked | failed
    error: q.last_error,
    result: q.result,
    created_at: q.created_at,
    updated_at: q.updated_at,
  }))

  return NextResponse.json({
    tone: toneR.data,
    profile: profR.data,
    ig_username: igR.data?.ig_username || null,
    joined_at: profR.data?.created_at || null,
    products: products.slice(0, 50),
    files: filesR.data || [],
    urgent: urgentR.data || [],
    queue,
    stats: {
      total_products: products.length,
      total_chunks: chunksR.data?.length || 0,
      total_files: filesR.data?.length || 0,
      queued: queue.filter(q => q.status === 'pending' || q.status === 'processing').length,
      blocked: queue.filter(q => q.status === 'blocked').length,
    },
  })
}
