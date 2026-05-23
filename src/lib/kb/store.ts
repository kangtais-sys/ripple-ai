// KB 청크 저장·검색 — Supabase 헬퍼
//
// 흐름:
// 1. 텍스트 → chunkText() → 청크 배열
// 2. 각 청크 → Voyage 임베딩
// 3. knowledge_chunks 에 batch insert
// 4. 사용자 user_type 재분류

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateEmbeddingsBatch, isEmbeddingConfigured } from './embedding'
import { chunkText, extractPrice, extractDomain, categorizeByDomain, type Chunk } from './chunker'

export type SourceType =
  | 'link' | 'link_url' | 'image' | 'pdf' | 'docx' | 'csv' | 'sheet'
  | 'urgent' | 'manual' | 'migration' | 'tone_sample'

export interface StoreOptions {
  sourceType: SourceType
  sourceId?: string
  sourceLabel?: string
  sourceUrl?: string
  priority?: number      // default 1, urgent=10
  expiresAt?: string     // ISO timestamp, 긴급 컨텍스트 만료
  // INSERT 성공 후 같은 user + source_url(없으면 source_label)의
  // 기존 활성 chunks 를 is_active=false 로 soft-deactivate.
  // 자기 자신(방금 INSERT 한 chunkIds)은 제외. INSERT 실패 시 미실행.
  // 답글 검색은 is_active=true 만 보므로 답글 흐름 영향 0.
  replaceBySource?: boolean
}

export interface StoreResult {
  inserted: number
  chunkIds: string[]
  skipped: number
  error?: string
}

/**
 * 텍스트 → 청크화 → 임베딩 → DB insert.
 * Voyage 미설정 시 임베딩 없이 청크만 저장 (추후 backfill 가능).
 */
export async function storeKnowledge(
  sb: SupabaseClient,
  userId: string,
  text: string,
  options: StoreOptions,
): Promise<StoreResult> {
  const chunks = chunkText(text)
  if (chunks.length === 0) {
    return { inserted: 0, chunkIds: [], skipped: 0, error: 'empty_text' }
  }

  const domain = options.sourceUrl ? extractDomain(options.sourceUrl) : null
  const baseCategory = categorizeByDomain(domain)

  // 1) 임베딩 일괄 생성 (가능하면)
  let embeddings: number[][] = []
  if (isEmbeddingConfigured()) {
    try {
      const results = await generateEmbeddingsBatch(chunks.map((c) => c.content))
      embeddings = results
    } catch (e) {
      console.error('[kb/store] embedding failed:', e)
      // fail-soft: 임베딩 없이도 청크 저장 (검색 못 함, 추후 backfill)
    }
  }

  // 2) 청크별 가격·카테고리 추출
  const rows = chunks.map((chunk, i) => {
    const price = extractPrice(chunk.content)
    return {
      user_id: userId,
      source_type: options.sourceType,
      source_id: options.sourceId || null,
      source_label: options.sourceLabel || null,
      source_url: options.sourceUrl || null,
      source_domain: domain,
      content: chunk.content,
      embedding: embeddings[i] || null,
      detected_price: price?.amount || null,
      detected_currency: price?.currency || null,
      category: price ? 'product' : baseCategory,
      priority: options.priority ?? 1,
      expires_at: options.expiresAt || null,
      is_active: true,
    }
  })

  // 3) batch insert
  const { data, error } = await sb
    .from('knowledge_chunks')
    .insert(rows)
    .select('id')

  if (error) {
    console.error('[kb/store] insert failed:', error)
    return { inserted: 0, chunkIds: [], skipped: chunks.length, error: error.message }
  }

  // 3-b) replaceBySource: INSERT 성공 후에만 같은 source 의 옛 chunks soft-deactivate
  //   - 같은 user_id + source_url (없으면 source_label) 매치
  //   - 방금 INSERT 한 chunkIds 는 제외 (자기 자신 비활성화 방지)
  //   - update 실패해도 throw 안 함 (INSERT 는 이미 성공, fail-soft)
  if (options.replaceBySource && data && data.length > 0) {
    const newIds = data.map((r) => r.id as string)
    try {
      let q = sb
        .from('knowledge_chunks')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('is_active', true)
        .not('id', 'in', `(${newIds.join(',')})`)
      if (options.sourceUrl) {
        q = q.eq('source_url', options.sourceUrl)
      } else if (options.sourceLabel) {
        q = q.is('source_url', null).eq('source_label', options.sourceLabel)
      } else {
        // source 키가 없으면 deactivate 대상 없음 → skip
        q = null as never
      }
      if (q) {
        const { error: deactErr } = await q
        if (deactErr) {
          console.warn('[kb/store] replaceBySource deactivate failed (insert succeeded):', deactErr.message)
        }
      }
    } catch (e) {
      console.warn('[kb/store] replaceBySource exception (insert succeeded):', e)
    }
  }

  // 4) user_type 비동기 재분류 (debounce 없이 매 저장마다 — 가벼움)
  sb.rpc('classify_user_type', { p_user_id: userId })
    .then(({ data: newType }) => {
      if (newType) {
        return sb
          .from('profiles')
          .update({
            user_type: newType,
            user_type_classified_at: new Date().toISOString(),
          })
          .eq('id', userId)
          .eq('user_type_manual', false)  // 사용자 수동 설정 안 한 경우만
      }
    })
    .then(() => {})

  return {
    inserted: rows.length,
    chunkIds: (data || []).map((r) => r.id as string),
    skipped: 0,
  }
}

/**
 * KB 청크 비활성화 (soft delete)
 */
export async function deactivateChunks(
  sb: SupabaseClient,
  userId: string,
  options: { sourceId?: string; sourceUrl?: string },
): Promise<number> {
  let query = sb
    .from('knowledge_chunks')
    .update({ is_active: false })
    .eq('user_id', userId)

  if (options.sourceId) query = query.eq('source_id', options.sourceId)
  if (options.sourceUrl) query = query.eq('source_url', options.sourceUrl)

  const { count } = await query
  return count || 0
}
