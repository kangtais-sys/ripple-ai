// src/inngest/workers/fetch-url.ts
import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { extractContent } from '@/lib/parsers/extractor'

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

/**
 * Step 1: URL을 fetch + 본문 텍스트 추출
 * - Jina Reader 1차 시도
 * - 실패 시 Firecrawl fallback
 * - 또 실패 시 quickParse (OG meta + JSON-LD만)
 *
 * 추출한 raw_text는 learn_queue 테이블에 저장.
 * (메모리에 끼고 다음 step에 넘기지 않음 — OOM 방지 핵심)
 */
export const fetchUrlWorker = inngest.createFunction(
  {
    id: 'learn-fetch-url',
    name: '학습 URL fetch',
    retries: 2, // 일시적 네트워크 오류 대응
    concurrency: {
      limit: 1, // OOM 방지 — warm instance 동시 run 누적 차단
    },
    triggers: { event: 'learn/url.requested' },
  },
  async ({ event, step, logger }) => {
    const { userId, url, sourceLabel, sourceType, blockId } = event.data
    const sb = admin()

    // step.run으로 감싸면 실패 시 이 step만 재시도. 메모리도 step 끝나면 해제.
    const result = await step.run('extract-content', async () => {
      logger.info('[fetch-url] start', { url })

      const extracted = await extractContent(url, {
        timeoutMs: 12000,
        maxBytes: 2 * 1024 * 1024, // 2MB cap (이거 넘으면 cut)
      })

      if (!extracted.text || extracted.text.length < 50) {
        // 너무 짧으면 학습 자료로서 가치 없음
        throw new Error(
          `extracted_too_short: ${extracted.text?.length ?? 0} chars from ${extracted.source}`,
        )
      }

      return extracted
    })

    // raw_text를 learn_queue에 저장 (다음 step이 읽어감)
    const rawTextId = await step.run('save-raw-text', async () => {
      const { data, error } = await sb
        .from('learn_queue')
        .upsert(
          {
            user_id: userId,
            url,
            label: sourceLabel ?? null,
            source_type: sourceType ?? 'manual',
            block_id: blockId ?? null,
            raw_text: result.text,
            raw_meta: result.meta ?? {},
            extractor_used: result.source, // 'jina' | 'firecrawl' | 'quick'
            status: 'text_ready',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,url' },
        )
        .select('id')
        .single()

      if (error) throw new Error(`learn_queue_upsert_failed: ${error.message}`)
      return data.id as string
    })

    // 다음 step 트리거 (chunk worker)
    await step.sendEvent('trigger-chunk', {
      name: 'learn/text.ready',
      data: {
        userId,
        url,
        sourceLabel,
        sourceType,
        blockId,
        rawTextId,
      },
    })

    return { ok: true, rawTextId, extractor: result.source, length: result.text.length }
  },
)
