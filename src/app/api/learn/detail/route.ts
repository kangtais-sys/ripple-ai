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
  if (!source) return NextResponse.json({ error: 'source required' }, { status: 400 })

  const sb = admin()
  let q = sb.from('knowledge_chunks')
    .select('id, content, source_type, source_label, source_url, source_domain, detected_price, detected_currency, category, created_at')
    .eq('user_id', u.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(200)

  // source 가 url 이면 source_url 매치, 아니면 source_label 매치
  if (/^https?:\/\//i.test(source)) {
    q = q.eq('source_url', source)
  } else {
    q = q.or(`source_label.eq.${source},source_url.eq.${source}`)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const chunks = (data || []).map(c => ({
    id: c.id,
    content: c.content,
    category: c.category,
  }))

  const head = data?.[0]
  return NextResponse.json({
    source: {
      label: head?.source_label || source,
      url: head?.source_url || null,
      domain: head?.source_domain || null,
      category: head?.category || null,
      type: head?.source_type || null,
    },
    chunks,
    count: chunks.length,
  })
}
