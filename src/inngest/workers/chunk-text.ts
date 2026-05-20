// src/inngest/workers/chunk-text.ts
import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { chunkText } from '@/lib/kb/chunker'

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

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
    concurrency: { limit: 10 },
    triggers: { event: 'learn/text.ready' },
  },
  async ({ event, step, logger }) => {
    const { userId, url, sourceLabel, rawTextId } = event.data
    const sb = admin()

    // raw_text 읽기
    const rawText = await step.run('load-raw-text', async () => {
      const { data, error } = await sb
        .from('learn_queue')
        .select('raw_text, raw_meta')
        .eq('id', rawTextId)
        .single()

      if (error || !data?.raw_text) {
        throw new Error(`raw_text_not_found: ${error?.message}`)
      }
      return data.raw_text as string
    })

    // 기존 청크 정리 (재학습 시 중복 방지)
    await step.run('cleanup-old-chunks', async () => {
      await sb
        .from('knowledge_chunks')
        .delete()
        .eq('user_id', userId)
        .eq('source_url', url)
    })

    // 청크화 — 300자 단위, 50자 overlap
    const chunks = await step.run('split-chunks', async () => {
      const result = chunkText(rawText, 300, 50)
      logger.info('[chunk-text] split', { url, count: result.length })
      return result
    })

    if (chunks.length === 0) {
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
      return (data ?? []).map((r) => r.id as string)
    })

    // queue 상태 업데이트
    await step.run('mark-chunks-ready', async () => {
      await sb
        .from('learn_queue')
        .update({
          status: 'chunks_ready',
          chunk_count: chunkIds.length,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rawTextId)
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

    return { ok: true, chunks: chunkIds.length }
  },
)
