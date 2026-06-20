// src/inngest/workers/chunk-text.ts
import { inngest } from '../client'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { chunkText } from '@/lib/kb/chunker'

let _admin: SupabaseClient | null = null
const admin = (): SupabaseClient => {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 0 } },
      },
    )
  }
  return _admin
}

function memSnap(logger: { info: (msg: string, data?: object) => void }, label: string) {
  const m = process.memoryUsage()
  logger.info(`[mem] ${label}`, {
    heapUsedMB: Math.round(m.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(m.heapTotal / 1024 / 1024),
    rssMB: Math.round(m.rss / 1024 / 1024),
    externalMB: Math.round(m.external / 1024 / 1024),
  })
}

/**
 * Step 2: raw_text를 chunks로 분할 + DB insert (embedding=null)
 *
 * 핵심: raw_text를 DB에서 읽고, 청크화 후 즉시 DB insert.
 * 메모리에는 현재 처리중인 청크 1개만 들고 있음 → OOM 불가능.
 */
export const chunkTextWorker = inngest.createFunction(
  {
    id: 'learn-chunk-text',
    name: '학습 텍스트 청크화',
    retries: 1,
    concurrency: { limit: 5 },
    triggers: { event: 'learn/text.ready' },
  },
  async ({ event, step, logger }) => {
    const { userId, url, sourceLabel, rawTextId } = event.data
    const sb = admin()
    memSnap(logger, 'chunk-text:enter')

    // raw_text 읽기
    const rawText = await step.run('load-raw-text', async () => {
      memSnap(logger, 'load-raw:before')
      const { data, error } = await sb
        .from('learn_queue')
        .select('raw_text, raw_meta')
        .eq('id', rawTextId)
        .single()

      if (error || !data?.raw_text) {
        throw new Error(`raw_text_not_found: ${error?.message}`)
      }
      memSnap(logger, 'load-raw:after')
      return data.raw_text as string
    })
    memSnap(logger, 'after-load-raw-step')

    // ★ C단계(soft-deactivate): 여기서 옛 chunks 를 DELETE 하지 않는다.
    //   기존: cleanup-old-chunks 가 INSERT 전에 hard DELETE → 재크롤이 빈텍스트/봇차단/INSERT실패 시
    //         옛 chunks 만 사라지고 새것은 못 들어와 데이터 손실.
    //   변경: 새 chunks 를 먼저 INSERT 하고, 임베딩까지 끝난 뒤(embed-chunks worker) 같은 source_url 의
    //         옛 활성 chunks 를 is_active=false 로 soft-deactivate. INSERT/임베딩 실패 시 옛것 그대로 → 손실 0.
    //         답글 검색(search_knowledge)은 is_active=true 만 보므로 발송 흐름 영향 0.

    // 청크화 — 300자 단위, 50자 overlap
    const chunks = await step.run('split-chunks', async () => {
      memSnap(logger, 'split:before')
      const result = chunkText(rawText, 300, 50)
      logger.info('[chunk-text] split', { url, count: result.length })
      memSnap(logger, 'split:after')
      return result
    })
    memSnap(logger, 'after-split-step')

    if (chunks.length === 0) {
      // soft-deactivate 방식: DELETE 안 했으므로 옛 chunks 가 그대로 살아있음 → 빈 재크롤로 인한 손실 0.
      logger.warn('[chunk-text] no chunks generated', { url })
      await sb
        .from('learn_queue')
        .update({ status: 'skipped', last_error: 'no_chunks' })
        .eq('id', rawTextId)
      return { ok: true, chunks: 0 }
    }

    // chunks를 DB에 batch insert (embedding=null로)
    const domain = (() => {
      try {
        return new URL(url).hostname
      } catch {
        return null
      }
    })()

    const chunkIds = await step.run('insert-chunks', async () => {
      memSnap(logger, 'insert:before')
      const rows = chunks.map((chunk) => ({
        user_id: userId,
        source_type: 'link_url',
        source_url: url,
        source_label: sourceLabel ?? url,
        source_domain: domain,
        content: chunk.content,
        embedding: null, // 다음 step에서 채움
        is_active: true,
        created_at: new Date().toISOString(),
      }))

      const { data, error } = await sb
        .from('knowledge_chunks')
        .insert(rows)
        .select('id')

      if (error) throw new Error(`chunks_insert_failed: ${error.message}`)
      memSnap(logger, 'insert:after')
      return (data ?? []).map((r) => r.id as string)
    })
    memSnap(logger, 'after-insert-step')

    // queue 상태 업데이트
    await step.run('mark-chunks-ready', async () => {
      memSnap(logger, 'mark-chunks:before')
      await sb
        .from('learn_queue')
        .update({
          status: 'chunks_ready',
          chunk_count: chunkIds.length,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rawTextId)
      memSnap(logger, 'mark-chunks:after')
    })

    // 임베딩 워커 트리거
    await step.sendEvent('trigger-embed', {
      name: 'learn/chunks.ready',
      data: {
        userId,
        url,
        sourceLabel,
        chunkIds,
      },
    })
    memSnap(logger, 'chunk-text:exit')

    return { ok: true, chunks: chunkIds.length }
  },
)
