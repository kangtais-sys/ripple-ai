// GET /api/learn/detail?source=<source_url|source_label>&type=link|file
//   특정 자료의 학습 내용(청크 content) 리스트 반환

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

  const url = new URL(req.url)
  const source = url.searchParams.get('source') || ''
  const labelParam = url.searchParams.get('label') || ''
  if (!source) return NextResponse.json({ error: 'source required' }, { status: 400 })

  const sb = admin()
  const base = () => sb.from('knowledge_chunks')
    .select('id, content, source_type, source_label, source_url, source_domain, detected_price, detected_currency, category, created_at')
    .eq('user_id', u.id)
    .eq('is_active', true)

  // 1차: URL 매치
  let byUrl: Record<string, unknown>[] = []
  if (/^https?:\/\//i.test(source)) {
    const { data } = await base().eq('source_url', source).order('created_at', { ascending: true }).limit(200)
    byUrl = data || []
  }

  // 2차: label 매치 (block 텍스트 임베딩 chunks — source_url=null)
  // label 우선순위: labelParam > URL 매치 chunks 의 source_label > source 자체
  const labelKey = labelParam || (byUrl[0] as { source_label?: string })?.source_label || (/^https?:\/\//i.test(source) ? '' : source)
  let byLabel: Record<string, unknown>[] = []
  if (labelKey) {
    const { data } = await base().eq('source_label', labelKey).order('created_at', { ascending: true }).limit(200)
    byLabel = data || []
  }

  // 합치고 dedup (id 기준)
  const merged = new Map<string, Record<string, unknown>>()
  for (const c of [...byUrl, ...byLabel]) merged.set(c.id as string, c)
  const data = Array.from(merged.values())

  const chunks = data.map(c => ({
    id: c.id,
    content: c.content,
    category: c.category,
  }))

  const head = data[0]
  return NextResponse.json({
    source: {
      label: (head?.source_label as string) || labelParam || source,
      url: (head?.source_url as string) || null,
      domain: (head?.source_domain as string) || null,
      category: (head?.category as string) || null,
      type: (head?.source_type as string) || null,
    },
    chunks,
    count: chunks.length,
  })
}
