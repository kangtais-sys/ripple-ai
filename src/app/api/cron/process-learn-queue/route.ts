// GET /api/cron/process-learn-queue
//   learn_queue 에서 pending 1개 fetch → Firecrawl scrape → KB 임베딩 + 이미지 OCR
//   매 1분마다 실행 (vercel.json crons)
//
// 헤더: Authorization: Bearer ${CRON_SECRET}
//
// 처리 흐름:
//   1) learn_queue pending 1개 → status='processing' 으로 잠금 (race 방지)
//   2) firecrawlScrape(url)
//      - blocked → status='blocked' 저장 후 종료 (사용자가 직접 추가하도록)
//   3) markdown → storeKnowledge → chunks N개
//   4) images → ocrImages → 성공한 텍스트만 storeKnowledge → ocr_chunks M개
//   5) status='done', result={chunks, ocr_chunks}
//
// 실패 처리:
//   - 일시 에러 → status='failed', last_error 저장 → attempts<3 면 다음 cron 에서 재시도
//   - attempts>=3 → status='blocked' (영구 차단, 무한 재시도 방지)

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { firecrawlScrape } from '@/lib/parsers/firecrawl'
import { storeKnowledge } from '@/lib/kb/store'
import { ocrImages } from '@/lib/kb/image-ocr'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_ATTEMPTS = 3
// OCR 동시 처리는 Vercel lambda memory limit 압박 — 이전 시도(concurrency 6→2)
// 에서 'instance' 에러로 lambda kill. 보수적 값으로 유지.
const OCR_MAX_IMAGES = 10
const OCR_CONCURRENCY = 2

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = admin()

  // 0) stale 'processing' 정리 — lambda timeout/crash 시 status 가 잠긴 채 남음
  //    5분 이상 processing 상태 + attempts<MAX_ATTEMPTS → pending 으로 복귀해 다시 시도
  await sb.from('learn_queue')
    .update({ status: 'pending' })
    .eq('status', 'processing')
    .lt('attempts', MAX_ATTEMPTS)
    .lt('updated_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())

  // 1) 가장 오래된 pending 1개 → status='processing' 으로 잠금
  const { data: candidate } = await sb
    .from('learn_queue')
    .select('id, user_id, url, label, attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!candidate) {
    return NextResponse.json({ ok: true, processed: 0, remaining: 0 })
  }

  // status 조건 추가 → 다른 cron instance 가 이미 잠갔으면 update 안 됨
  const { data: locked, error: lockErr } = await sb
    .from('learn_queue')
    .update({ status: 'processing', attempts: candidate.attempts + 1 })
    .eq('id', candidate.id)
    .eq('status', 'pending')
    .select('id, user_id, url, label, attempts')
    .maybeSingle()

  if (lockErr || !locked) {
    return NextResponse.json({ ok: true, processed: 0, message: 'race_lost' })
  }

  const { id, user_id, url, label, attempts } = locked

  try {
    // 2) Firecrawl scrape
    const scraped = await firecrawlScrape(url)

    if (!scraped.ok) {
      const isBlocked = scraped.blocked || attempts >= MAX_ATTEMPTS
      await sb.from('learn_queue').update({
        status: isBlocked ? 'blocked' : 'failed',
        last_error: scraped.error || 'scrape_failed',
        result: { error: scraped.error || null },
      }).eq('id', id)

      return NextResponse.json({
        ok: true,
        processed: 1,
        id,
        status: isBlocked ? 'blocked' : 'failed',
        error: scraped.error,
      })
    }

    // 3) 본문 텍스트 → chunks
    let textChunks = 0
    if (scraped.markdown) {
      const content = [scraped.title, scraped.description, scraped.markdown]
        .filter(Boolean).join('\n\n')
      const r = await storeKnowledge(sb, user_id, content, {
        sourceType: 'link_url',
        sourceUrl: url,
        sourceLabel: scraped.title || label || url,
      })
      textChunks = r.inserted
    }

    // 4) 이미지 OCR → 성공한 것만 저장 (개별 실패는 skip)
    let ocrChunks = 0
    if (scraped.images && scraped.images.length > 0) {
      const ocrResults = await ocrImages(scraped.images, {
        concurrency: OCR_CONCURRENCY,
        max: OCR_MAX_IMAGES,
      })
      for (const r of ocrResults) {
        if (!r.text) continue
        try {
          const stored = await storeKnowledge(sb, user_id, r.text, {
            sourceType: 'link_url',
            sourceUrl: url,
            sourceLabel: scraped.title || label || url,
          })
          ocrChunks += stored.inserted
        } catch (e) {
          console.warn('[process-learn-queue] OCR chunk store failed:', e)
        }
      }
    }

    // 5) 완료
    await sb.from('learn_queue').update({
      status: 'done',
      result: { chunks: textChunks, ocr_chunks: ocrChunks },
      last_error: null,
    }).eq('id', id)

    // 남은 pending 개수
    const { count } = await sb
      .from('learn_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')

    return NextResponse.json({
      ok: true,
      processed: 1,
      id,
      status: 'done',
      chunks: textChunks,
      ocr_chunks: ocrChunks,
      remaining: count ?? 0,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[process-learn-queue] fatal:', msg)

    const isPermanent = attempts >= MAX_ATTEMPTS
    await sb.from('learn_queue').update({
      status: isPermanent ? 'blocked' : 'failed',
      last_error: msg.slice(0, 500),
    }).eq('id', id)

    return NextResponse.json({
      ok: false,
      processed: 1,
      id,
      status: isPermanent ? 'blocked' : 'failed',
      error: msg,
    }, { status: 500 })
  }
}
