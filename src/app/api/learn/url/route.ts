// POST /api/learn/url
//   사용자가 학습할 URL 1개 입력 → 도메인 분기 → 결과 반환
//
// 분기:
//   A. 링크인바이오 서비스 (linktr.ee, infolink 등)
//      → parseLinkbio() → 프로필 + 링크 N개 추출 → preview 반환 (동기, 가벼움)
//      → 사용자 [그대로 옮길게요] 클릭 시 /api/learn/migrate 호출
//   B. 일반 URL
//      → 알려진 봇 차단 도메인이면 즉시 'blocked' 안내
//      → 그 외에는 learn_queue 에 적재 (status='pending', source='chat')
//      → cron 이 1분 이내 처리 (Firecrawl scrape + OCR)
//
// 이전 구조: Vercel function 안에서 quickParse → storeKnowledge 동기 호출.
//   → JS 렌더링 페이지·봇 차단·OCR 시 timeout/instance kill.
// 새 구조: 큐에 insert 만 하고 즉시 응답 → cron 이 처리.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { parseLinkbio, detectLinkbioService } from '@/lib/parsers/linkbio'
import { extractDomain } from '@/lib/kb/chunker'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { url?: string; label?: string }
  const url = (body.url || '').trim()
  const label = (body.label || '').trim() || undefined

  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 })
  }

  const sb = admin()
  const domain = extractDomain(url) || 'unknown'

  // 1) 링크인바이오 → 마이그레이션 preview (동기, 가벼움)
  const linkbioService = detectLinkbioService(url)
  if (linkbioService) {
    const result = await parseLinkbio(url)
    if (result.ok && (result.links?.length || 0) > 0) {
      return NextResponse.json({ flow: 'migration', result })
    }
    // fallthrough — linkbio 파싱 실패 시 일반 큐로
  }

  // 2) 알려진 봇 차단 도메인 → 즉시 안내 (큐에 안 넣음)
  const { data: policy } = await sb
    .from('crawl_policies')
    .select('policy, service_type, notes')
    .eq('domain', domain)
    .maybeSingle()

  if (policy?.policy === 'bot_blocked') {
    return NextResponse.json({
      flow: 'blocked',
      result: { ok: false, type: 'blocked', domain, error: 'known_bot_blocked' },
      service_type: policy.service_type,
      policy_note: policy.notes,
    })
  }

  // 3) 이미 학습된 URL → skip 안내
  const { data: existing } = await sb
    .from('knowledge_chunks')
    .select('id')
    .eq('user_id', u.id)
    .eq('source_url', url)
    .eq('is_active', true)
    .limit(1)
  if (existing && existing.length > 0) {
    return NextResponse.json({
      flow: 'already_learned',
      result: { ok: true, url, domain },
    })
  }

  // 4) 이미 큐에 있으면 재적재 X
  const { data: queuedExisting } = await sb
    .from('learn_queue')
    .select('id, status')
    .eq('user_id', u.id)
    .eq('url', url)
    .in('status', ['pending', 'processing'])
    .limit(1)
    .maybeSingle()
  if (queuedExisting) {
    return NextResponse.json({
      flow: 'queued',
      result: { id: queuedExisting.id, status: queuedExisting.status, url, label, queued_at: 'already' },
    })
  }

  // 5) 큐 적재 → 즉시 응답 (cron 이 1분 이내 처리)
  const { data: queued, error: queueErr } = await sb
    .from('learn_queue')
    .insert({
      user_id: u.id,
      url,
      label: label || domain,
      status: 'pending',
      source: 'chat',
    })
    .select('id, status, created_at')
    .single()

  if (queueErr) {
    console.error('[learn/url] queue insert failed:', queueErr)
    return NextResponse.json({ error: 'queue_insert_failed', detail: queueErr.message }, { status: 500 })
  }

  return NextResponse.json({
    flow: 'queued',
    result: { id: queued.id, status: queued.status, url, label, queued_at: queued.created_at },
  })
}
