// Voyage AI 임베딩 클라이언트
//
// docs: https://docs.voyageai.com/reference/embeddings-api
// model: voyage-3-lite (1024 차원, 한국어 OK, $0.02/M tokens)
// auth: VOYAGE_API_KEY env (sk-...)
//
// 추후 Cohere 등으로 교체 시 generateEmbedding 만 갈아끼우면 됨.
// DB 의 vector(1024) 차원만 맞추면 호환.

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'
const VOYAGE_MODEL = 'voyage-3-lite'
const VOYAGE_DIMENSIONS = 1024
// Voyage API hang 방지 — 응답이 15초 안에 안 오면 abort.
// 이전: signal 없음 → hang 시 outer try/catch 못 잡고 instance kill.
const VOYAGE_TIMEOUT_MS = 15_000

export interface EmbeddingResult {
  embedding: number[]
  tokens: number
  model: string
}

export function isEmbeddingConfigured(): boolean {
  return !!process.env.VOYAGE_API_KEY
}

/**
 * 단일 텍스트 임베딩 생성.
 * Voyage API 가 미설정이면 throw — 호출자가 fallback 처리.
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) throw new Error('VOYAGE_API_KEY env missing')
  if (!text || text.trim().length === 0) throw new Error('empty text')

  const res = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: text,
      input_type: 'document',
    }),
    signal: AbortSignal.timeout(VOYAGE_TIMEOUT_MS),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Voyage API ${res.status}: ${err.slice(0, 300)}`)
  }

  const data = await res.json()
  const embedding = data?.data?.[0]?.embedding
  if (!Array.isArray(embedding) || embedding.length !== VOYAGE_DIMENSIONS) {
    throw new Error(`Voyage: invalid embedding (length ${embedding?.length})`)
  }
  return {
    embedding,
    tokens: data?.usage?.total_tokens || 0,
    model: VOYAGE_MODEL,
  }
}

/**
 * 다수 텍스트 일괄 임베딩 (배치). 최대 128개/req
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) throw new Error('VOYAGE_API_KEY env missing')
  const validTexts = texts.filter((t) => t && t.trim().length > 0)
  if (validTexts.length === 0) return []

  const res = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: validTexts,
      input_type: 'document',
    }),
    signal: AbortSignal.timeout(VOYAGE_TIMEOUT_MS),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Voyage API ${res.status}: ${err.slice(0, 300)}`)
  }

  const data = await res.json()
  return (data?.data || []).map((d: { embedding: number[] }, i: number) => ({
    embedding: d.embedding,
    tokens: Math.round((data?.usage?.total_tokens || 0) / validTexts.length),
    model: VOYAGE_MODEL,
  }))
}

/**
 * 쿼리용 임베딩 (input_type=query 로 약간 다른 표현 학습)
 */
export async function generateQueryEmbedding(query: string): Promise<EmbeddingResult> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) throw new Error('VOYAGE_API_KEY env missing')

  const res = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: query,
      input_type: 'query',
    }),
    signal: AbortSignal.timeout(VOYAGE_TIMEOUT_MS),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Voyage API ${res.status}: ${err.slice(0, 300)}`)
  }

  const data = await res.json()
  return {
    embedding: data?.data?.[0]?.embedding,
    tokens: data?.usage?.total_tokens || 0,
    model: VOYAGE_MODEL,
  }
}
