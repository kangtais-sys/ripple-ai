// RAG 검색 — search_knowledge RPC 호출
// 쿼리 임베딩 → priority + 코사인 유사도 → 청크 N개 반환

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateQueryEmbedding, isEmbeddingConfigured } from '@/lib/kb/embedding'

export interface KnowledgeChunkResult {
  id: string
  content: string
  source_type: string
  source_label: string | null
  priority: number
  similarity: number
}

/**
 * 메시지 → 임베딩 → RAG 검색 → N개 청크
 * Voyage 미설정 시 priority 만으로 fallback (긴급 우선)
 */
export async function searchKnowledge(
  sb: SupabaseClient,
  userId: string,
  message: string,
  limit: number = 5,
): Promise<KnowledgeChunkResult[]> {
  // Fallback: 임베딩 없으면 priority desc 만으로 가져옴
  if (!isEmbeddingConfigured()) {
    const { data } = await sb
      .from('knowledge_chunks')
      .select('id, content, source_type, source_label, priority')
      .eq('user_id', userId)
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)
    return (data || []).map((r) => ({ ...r, similarity: 0 }))
  }

  try {
    const queryEmb = await generateQueryEmbedding(message)
    const { data, error } = await sb.rpc('search_knowledge', {
      p_user_id: userId,
      p_query_embedding: queryEmb.embedding,
      p_limit: limit,
    })
    if (error) {
      console.error('[v2-reply/rag] search_knowledge error:', error)
      return []
    }
    return (data || []) as KnowledgeChunkResult[]
  } catch (e) {
    console.error('[v2-reply/rag] failed:', e)
    return []
  }
}
