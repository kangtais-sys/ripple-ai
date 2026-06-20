// src/inngest/workers/embed-chunks.ts
import { inngest } from '../client'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { generateEmbeddingsBatch } from '@/lib/kb/embedding'

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
    memSnap(logger, 'embed-chunks:enter')

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
        memSnap(logger, `batch-${batchIdx}:before`)
        // 1) 청크 내용 가져오기
        const { data: rows, error: fetchErr } = await sb
          .from('knowledge_chunks')
          .select('id, content')
          .in('id', batch)

        if (fetchErr) throw new Error(`fetch_chunks_failed: ${fetchErr.message}`)
        if (!rows || rows.length === 0) return 0

        const contents = rows.map((r) => r.content as string)
        memSnap(logger, `batch-${batchIdx}:before-voyage`)

        // 2) Voyage 호출 (이 함수 내부에 timeout 있음)
        const vectors = await generateEmbeddingsBatch(contents)
        memSnap(logger, `batch-${batchIdx}:after-voyage`)

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
            .update({ embedding: '[' + vectors[i].join(',') + ']' })
            .eq('id', rows[i].id)
          if (updErr) throw new Error(`embedding_update_failed: ${updErr.message} (chunk ${rows[i].id})`)
          updated++
        }

        logger.info('[embed-chunks] batch done', {
          url,
          batchIdx,
          updated,
          total: rows.length,
        })
        memSnap(logger, `batch-${batchIdx}:after`)
        return updated
      })
      memSnap(logger, `after-batch-${batchIdx}-step`)

      totalEmbedded += embedded
    }

    // ★ C단계(soft-deactivate): 새 chunks 임베딩까지 끝난 지금, 같은 source_url 의 옛 활성 chunks 를 비활성화.
    //   - 여기서(임베딩 후) 끄는 이유: 그 전까지 옛 chunks 가 답글 검색에 살아있어 검색 끊김 0.
    //     (search_knowledge 는 embedding IS NOT NULL 만 보므로, embedding=null 인 새 chunks 는 임베딩 전엔 검색 안 됨)
    //   - 방금 임베딩한 chunkIds 는 제외. is_active=true 인 옛것만 끔. DELETE 아님 → 손실 0, 복구 가능.
    //   - 실패해도 throw 안 함(fail-soft): 새 chunks 는 이미 active+embedded. 옛것이 잠깐 더 남아도 손실 아님.
    //   - source_url 단위 매칭(source_type 무관)은 기존 동작과 동일 — "1 URL = 최신본".
    await step.run('deactivate-old-chunks', async () => {
      try {
        const { error: deactErr } = await sb
          .from('knowledge_chunks')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('source_url', url)
          .eq('is_active', true)
          .not('id', 'in', `(${chunkIds.join(',')})`)
        if (deactErr) {
          logger.warn('[embed-chunks] deactivate old chunks failed (new chunks already active+embedded)', {
            url,
            error: deactErr.message,
          })
        }
      } catch (e) {
        logger.warn('[embed-chunks] deactivate exception (fail-soft)', { url, error: String(e) })
      }
    })

    // queue 최종 상태
    await step.run('mark-done', async () => {
      memSnap(logger, 'mark-done:before')
      await sb
        .from('learn_queue')
        .update({
          status: 'done',
          embedded_count: totalEmbedded,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('url', url)
      memSnap(logger, 'mark-done:after')
    })
    memSnap(logger, 'embed-chunks:exit')

    return { ok: true, embedded: totalEmbedded, batches: batches.length }
  },
)
