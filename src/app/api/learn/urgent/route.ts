// GET·POST·DELETE /api/learn/urgent
//   긴급 컨텍스트 — 즉시 응대 반영 (priority=10 청크)
//
// 사용 사례: 배송 지연·품절·이벤트·환불 정책 변경 등 빠르게 모든 응대에 반영
//
// GET    — 현재 활성 긴급 공지 목록
// POST   — 새 긴급 공지 추가 (자동으로 임베딩 + priority=10 KB 청크 생성)
// DELETE — 긴급 공지 비활성화

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { storeKnowledge } from '@/lib/kb/store'

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
  const { data } = await sb
    .from('urgent_contexts')
    .select('id, content, expires_at, created_at')
    .eq('user_id', u.id)
    .eq('is_active', true)
    .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
    .order('created_at', { ascending: false })

  return NextResponse.json({ contexts: data || [] })
}

export async function POST(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { content?: string; expires_in_days?: number }
  const content = (body.content || '').trim()
  if (!content || content.length < 5) {
    return NextResponse.json({ error: 'content_required_min_5_chars' }, { status: 400 })
  }

  const expiresInDays = typeof body.expires_in_days === 'number' ? body.expires_in_days : 3
  const expiresAt = expiresInDays > 0
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null

  const sb = admin()

  // 1) KB 청크 임베딩 (priority=10)
  const kbResult = await storeKnowledge(sb, u.id, content, {
    sourceType: 'urgent',
    sourceLabel: '긴급 공지',
    priority: 10,
    expiresAt: expiresAt || undefined,
  })

  // 2) urgent_contexts row 생성 (관리용)
  const chunkId = kbResult.chunkIds[0] || null
  const { data, error } = await sb
    .from('urgent_contexts')
    .insert({
      user_id: u.id,
      content,
      is_active: true,
      expires_at: expiresAt,
      knowledge_chunk_id: chunkId,
    })
    .select('id, content, expires_at, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, context: data, kb: kbResult })
}

export async function DELETE(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const sb = admin()
  // 1) urgent_contexts 비활성화
  const { data } = await sb
    .from('urgent_contexts')
    .update({ is_active: false })
    .eq('id', id)
    .eq('user_id', u.id)
    .select('knowledge_chunk_id')
    .maybeSingle()

  // 2) 연결된 KB 청크도 비활성화
  if (data?.knowledge_chunk_id) {
    await sb
      .from('knowledge_chunks')
      .update({ is_active: false })
      .eq('id', data.knowledge_chunk_id)
  }

  return NextResponse.json({ ok: true })
}
