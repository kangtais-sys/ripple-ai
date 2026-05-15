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
  const [toneR, profR, chunksR, filesR, urgentR] = await Promise.all([
    sb.from('tone_profiles')
      .select('learned_style, persona_summary, persona_details, user_corrections, validation_completed_at')
      .eq('user_id', u.id)
      .maybeSingle(),
    sb.from('profiles')
      .select('user_type, user_type_manual, reply_mode, draft_mode_until')
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
  ])

  // 청크 → source_url 별 group
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

  for (const c of chunksR.data || []) {
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

  return NextResponse.json({
    tone: toneR.data,
    profile: profR.data,
    products: products.slice(0, 50),
    files: filesR.data || [],
    urgent: urgentR.data || [],
    stats: {
      total_products: products.length,
      total_chunks: chunksR.data?.length || 0,
      total_files: filesR.data?.length || 0,
    },
  })
}
