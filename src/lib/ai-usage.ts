// Claude API 토큰·비용 로깅 헬퍼
// Sonnet 4 단가 (2026-04 기준): input $3/MTok, output $15/MTok
// 캐시 5분 ttl: cache_creation_input $3.75/MTok, cache_read $0.30/MTok

import { createClient as createAdmin } from '@supabase/supabase-js'

// USD 센트 (소수점 4자리)로 계산
const PRICING: Record<string, { input: number; output: number; cache_read: number; cache_creation: number }> = {
  'claude-sonnet-4-20250514': { input: 0.0003, output: 0.0015, cache_read: 0.00003, cache_creation: 0.000375 },
  'claude-opus-4-5': { input: 0.0015, output: 0.0075, cache_read: 0.00015, cache_creation: 0.001875 },
  'claude-haiku-4-5-20251001': { input: 0.00008, output: 0.0004, cache_read: 0.000008, cache_creation: 0.0001 },
}

type UsageInput = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export function calculateCostCents(model: string, usage: UsageInput): number {
  const p = PRICING[model] || PRICING['claude-sonnet-4-20250514']
  const inTok = usage.input_tokens || 0
  const outTok = usage.output_tokens || 0
  const ccTok = usage.cache_creation_input_tokens || 0
  const crTok = usage.cache_read_input_tokens || 0
  return inTok * p.input + outTok * p.output + ccTok * p.cache_creation + crTok * p.cache_read
}

export type AIFeature = 'cardnews' | 'tone_learn' | 'reply_gen' | 'dm_gen' | 'translate' | 'classify' | 'other'

export async function logAIUsage(args: {
  userId: string
  feature: AIFeature
  model: string
  usage: UsageInput
  refType?: string
  refId?: string
}) {
  try {
    const admin = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )
    const cost = calculateCostCents(args.model, args.usage)
    await admin.from('ai_usage_logs').insert({
      user_id: args.userId,
      feature: args.feature,
      model: args.model,
      input_tokens: args.usage.input_tokens || 0,
      output_tokens: args.usage.output_tokens || 0,
      cache_read_tokens: args.usage.cache_read_input_tokens || 0,
      cache_creation_tokens: args.usage.cache_creation_input_tokens || 0,
      cost_usd_cents: cost,
      ref_type: args.refType || null,
      ref_id: args.refId || null,
    })
  } catch (e) {
    // 로깅 실패가 본 기능 막으면 안 됨 — 조용히 콘솔만
    console.error('[ai-usage] log failed', e)
  }
}
