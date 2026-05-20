// src/lib/kb/embedding.ts
// 기존 파일 교체. 핵심 변경: AbortSignal.timeout 추가, retry 추가.

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings'
const VOYAGE_MODEL = 'voyage-3-lite'
const TIMEOUT_MS = 15000 // 15초. 이전엔 timeout 없어서 hang → instance kill

/**
 * 단일 임베딩
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const result = await generateEmbeddingsBatch([text])
  return result[0]
}

/**
 * 배치 임베딩 — Voyage max 128개, 실제로는 32개씩 권장
 *
 * 핵심 변경:
 * - AbortSignal.timeout(15초) — 이전엔 무한 hang 가능
 * - 1회 retry (네트워크 일시 오류 대응)
 * - 응답 파싱 후 input array는 명시적 참조 해제 안 함
 *   (V8이 알아서 GC 하지만, 호출하는 쪽이 step.run으로 감싸면 자동 해제)
 */
export async function generateEmbeddingsBatch(
  texts: string[],
): Promise<number[][]> {
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error('voyage_no_api_key')
  }
  if (texts.length === 0) return []
  if (texts.length > 128) {
    throw new Error(`voyage_batch_too_large: ${texts.length}`)
  }

  let lastErr: Error | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(VOYAGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        },
        body: JSON.stringify({
          model: VOYAGE_MODEL,
          input: texts,
          input_type: 'document',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`voyage_http_${res.status}: ${errText.slice(0, 200)}`)
      }

      const json = (await res.json()) as {
        data: Array<{ embedding: number[]; index: number }>
      }

      // index 순서대로 정렬 (Voyage가 보장하지만 안전하게)
      const sorted = [...json.data].sort((a, b) => a.index - b.index)
      return sorted.map((d) => d.embedding)
    } catch (e: any) {
      lastErr = e
      // timeout이나 5xx만 retry. 4xx는 즉시 throw.
      const msg = String(e?.message ?? '')
      if (msg.includes('voyage_http_4')) break
      // 마지막 시도 아니면 짧게 대기 후 재시도
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
    }
  }

  throw lastErr ?? new Error('voyage_unknown_error')
}

// ─────────────────────────────────────────────────────────────
// Legacy API shim — 기존 호출자 (rag.ts, store.ts) 호환용
// 새 코드는 generateEmbedding / generateEmbeddingsBatch 직접 사용 권장
// ─────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  embedding: number[]
  tokens?: number
  model?: string
}

export function isEmbeddingConfigured(): boolean {
  return !!process.env.VOYAGE_API_KEY
}

/**
 * Query 임베딩 — input_type: 'query' 명시 (검색용)
 * Voyage는 document와 query 임베딩이 다름. 검색 정확도에 영향.
 */
export async function generateQueryEmbedding(text: string): Promise<EmbeddingResult> {
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error('voyage_no_api_key')
  }

  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'voyage-3-lite',
      input: [text],
      input_type: 'query', // 핵심: 검색용 임베딩
    }),
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`voyage_http_${res.status}: ${errText.slice(0, 200)}`)
  }

  const json = (await res.json()) as {
    data: Array<{ embedding: number[] }>
  }
  return {
    embedding: json.data[0].embedding,
    model: 'voyage-3-lite',
  }
}
