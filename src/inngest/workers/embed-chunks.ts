// src/inngest/workers/embed-chunks.ts
import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { generateEmbeddingsBatch } from '@/lib/kb/embedding'

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

const BATCH_SIZE = 32 // Voyage max 128이지만 메모리 안전하게 32

/**
 * Step 3: chunks를 32개씩 잘라서 Voyage 임베딩 → DB 업데이트
 *
 * 핵심: 32개 배치마다 별도 step.run.
 * 한 배치 처리 후 메모리 해제됨 → 청크 1000개여도 OOM 없음.
 */
export const embedChunksWorker = inngest.createFunction(
  {
    id: 'learn-embed-chunks',
    name: '학습 청크 임베딩',
    retries: 2,
    concurrency: { limit: 3 }, // Voyage API rate limit 보호
    triggers: { event: 'learn/chunks.ready' },
  },
  async ({ event, step, logger }) => {
    const { userId, url, chunkIds } = event.data
    const sb = admin()

    if (chunkIds.length === 0) return { ok: true, embedded: 0 }

    // 32개씩 나눠서 처리
    const batches: string[][] = []
    for (let i = 0; i < chunkIds.length; i += BATCH_SIZE) {
      batches.push(chunkIds.slice(i, i + BATCH_SIZE))
    }

    let totalEmbedded = 0

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]

      // 각 배치를 별도 step으로 — step 끝나면 메모리 해제됨
      const embedded = await step.run(`embed-batch-${batchIdx}`, async () => {
        // 1) 청크 내용 가져오기
        const { data: rows, error: fetchErr } = await sb
          .from('knowledge_chunks')
          .select('id, content')
          .in('id', batch)

        if (fetchErr) throw new Error(`fetch_chunks_failed: ${fetchErr.message}`)
        if (!rows || rows.length === 0) return 0

        const contents = rows.map((r) => r.content as string)

        // 2) Voyage 호출 (이 함수 내부에 timeout 있음)
        const vectors = await generateEmbeddingsBatch(contents)

        if (vectors.length !== rows.length) {
          throw new Error(
            `embedding_count_mismatch: got ${vectors.length}, expected ${rows.length}`,
          )
        }

        // 3) 각 청크 embedding 업데이트
        // pgvector에 array는 ::vector cast 필요. supabase-js는 array를 자동 처리하지만
        // 안전하게 RPC나 raw upsert로. 여기선 update를 row별로 (배치 32개니까 빠름)
        let updated = 0
        for (let i = 0; i < rows.length; i++) {
          const { error: updErr } = await sb
            .from('knowledge_chunks')
            .update({ embedding: vectors[i] })
            .eq('id', rows[i].id)
          if (!updErr) updated++
        }

        logger.info('[embed-chunks] batch done', {
          url,
          batchIdx,
          updated,
          total: rows.length,
        })
        return updated
      })

      totalEmbedded += embedded
    }

    // queue 최종 상태
    await step.run('mark-done', async () => {
      await sb
        .from('learn_queue')
        .update({
          status: 'done',
          embedded_count: totalEmbedded,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('url', url)
    })

    return { ok: true, embedded: totalEmbedded, batches: batches.length }
  },
)
