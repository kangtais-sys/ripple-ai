// POST /api/learn/url
//   사용자가 학습할 URL 1개 입력 → 도메인 분기 → 결과 반환
//
// 분기:
//   A. 링크인바이오 서비스 (linktr.ee, infolink 등)
//      → parseLinkbio() → 프로필 + 링크 N개 추출 → preview 반환
//      → 사용자 [그대로 옮길게요] 클릭 시 /api/learn/migrate 호출
//   B. 일반 URL (스마트스토어, blog 등)
//      → quickParse() → 1차 시도
//      → 성공 시 KB 임베딩 즉시 + result 반환
//      → 봇 차단 시 fallback 옵션 안내
//
// 가입 직후 첫 URL 또는 학습 탭에서 신규 URL 추가 시 양쪽 다 호출
//
// Body: { url: string, persist?: boolean }
//   persist=false → preview 만 (linkbio 마이그레이션 전 확인용)
//   persist=true  → KB 에 즉시 임베딩 (일반 URL 의 경우)
// Response: ParseResult + KB insert 결과

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { parseLinkbio, detectLinkbioService } from '@/lib/parsers/linkbio'
import { quickParse } from '@/lib/parsers/quick'
import { storeKnowledge } from '@/lib/kb/store'
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

  const body = await req.json().catch(() => ({})) as { url?: string; persist?: boolean }
  const url = (body.url || '').trim()
  const persist = body.persist !== false  // default: persist

  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 })
  }

  const sb = admin()
  const domain = extractDomain(url) || 'unknown'

  // 1) 도메인 정책 캐시 확인 — 봇 차단 알려진 도메인이면 즉시 fallback 안내
  const { data: policy } = await sb
    .from('crawl_policies')
    .select('policy, service_type, notes')
    .eq('domain', domain)
    .maybeSingle()

  // 2) 링크인바이오 서비스 감지 → 마이그레이션 preview
  const linkbioService = detectLinkbioService(url)
  if (linkbioService) {
    const result = await parseLinkbio(url)
    if (result.ok && (result.links?.length || 0) > 0) {
      return NextResponse.json({
        flow: 'migration',
        result,
        policy_hint: policy?.policy,
      })
    }
    // fallthrough — linkbio 파싱 실패 시 일반 fallback
  }

  // 3) 알려진 봇 차단 → 즉시 fallback 안내 (시간 낭비 방지)
  if (policy?.policy === 'bot_blocked') {
    return NextResponse.json({
      flow: 'blocked',
      result: { ok: false, type: 'blocked', domain, error: 'known_bot_blocked' },
      service_type: policy.service_type,
      policy_note: policy.notes,
    })
  }

  // 4) 일반 URL — quick 파서
  const parsed = await quickParse(url)

  // 5) 차단 감지 시 정책 캐시 업데이트
  if (parsed.type === 'blocked') {
    await sb.from('crawl_policies').upsert({
      domain,
      policy: 'bot_blocked',
      fail_count: (policy?.notes ? 1 : 0) + 1,
      last_checked_at: new Date().toISOString(),
      notes: parsed.error,
    }, { onConflict: 'domain' })
    return NextResponse.json({
      flow: 'blocked',
      result: parsed,
    })
  }

  // 6) 이미지 페이지 → Vision fallback 안내
  if (parsed.type === 'image_page') {
    await sb.from('crawl_policies').upsert({
      domain,
      policy: 'image_page',
      last_checked_at: new Date().toISOString(),
    }, { onConflict: 'domain' })
    return NextResponse.json({
      flow: 'image_page',
      result: parsed,
    })
  }

  // 7) 성공 — persist 옵션이면 KB 에 즉시 임베딩
  let storeResult = null
  if (persist && parsed.ok && parsed.text) {
    const contentForKb = [
      parsed.title,
      parsed.description,
      parsed.text,
    ].filter(Boolean).join('\n\n')

    storeResult = await storeKnowledge(sb, u.id, contentForKb, {
      sourceType: 'link_url',
      sourceUrl: url,
      sourceLabel: parsed.title || domain,
    })

    // 정책 캐시 — 성공
    await sb.from('crawl_policies').upsert({
      domain,
      policy: 'quick_ok',
      success_count: (policy?.notes ? 0 : 0) + 1,
      service_type: parsed.type === 'product' ? 'commerce' : 'other',
      last_checked_at: new Date().toISOString(),
    }, { onConflict: 'domain' })
  }

  return NextResponse.json({
    flow: parsed.type,
    result: parsed,
    kb: storeResult,
  })
}
