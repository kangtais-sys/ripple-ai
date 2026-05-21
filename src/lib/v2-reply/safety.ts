// 응대 발송 전 안전 체크 — 계정 차단 위험 막는 7가지 빌트인 장치
//
// 모든 send 시도는 이 함수 통과 후에만 IG API 호출.

import type { SupabaseClient } from '@supabase/supabase-js'

const BANNED_CONTENT_PATTERNS = [
  // 의료 자문 — 사람 개입 필요
  /(처방|진단|병원 가|약 복용|의학적|치료법|부작용)/i,
  // 금융 자문
  /(투자 추천|수익률|보장|확실히 돌\b|손실 안)/i,
  // 화장품법 가드 — 의약품 효능 표현 (식약처 기능성 인증 없으면 광고 금지)
  /(치료해|치료됩|치료할\b|약효|의약품|약리|기능성 효과)/i,
  // 화장품법 가드 — 절대적/단정적 안전·효과 약속 (광고법 위반 가능)
  /(절대 부작용 없|100% 안전|확실히 좋아져|반드시 효과)/i,
]

export type SafetyStatus =
  | { ok: true }
  | { ok: false; reason: 'window_expired'; details?: string }
  | { ok: false; reason: 'spam_pattern'; details?: string }
  | { ok: false; reason: 'banned_content'; details?: string }
  | { ok: false; reason: 'rate_limit'; details?: string }
  | { ok: false; reason: 'hours_outside'; details?: string }

export interface SafetyCheckInput {
  userId: string
  fanId: string | null
  fanWindowExpiresAt?: string | null
  replyContent: string
  channel: 'dm' | 'comment'
}

/**
 * 발송 직전 안전 체크. ok 면 발송, !ok 면 큐 또는 사람 개입.
 */
export async function checkSafety(
  sb: SupabaseClient,
  input: SafetyCheckInput,
): Promise<SafetyStatus> {
  // 1) 24h 창 만료 체크 (DM 만 해당. comment 답글은 무관)
  if (input.channel === 'dm' && input.fanWindowExpiresAt) {
    if (new Date(input.fanWindowExpiresAt) < new Date()) {
      return { ok: false, reason: 'window_expired', details: 'fan window expired' }
    }
  }

  // 2) 금지 콘텐츠 필터
  for (const pattern of BANNED_CONTENT_PATTERNS) {
    if (pattern.test(input.replyContent)) {
      return { ok: false, reason: 'banned_content', details: `pattern: ${pattern}` }
    }
  }

  // 3) 응대 시간대 외 (사용자 설정)
  const { data: prof } = await sb
    .from('profiles')
    .select('reply_hours_start, reply_hours_end')
    .eq('id', input.userId)
    .maybeSingle()
  if (prof?.reply_hours_start && prof?.reply_hours_end) {
    const now = new Date()
    const hr = now.getHours()
    const mn = now.getMinutes()
    const cur = hr * 60 + mn
    const [sh, sm] = (prof.reply_hours_start as string).split(':').map(Number)
    const [eh, em] = (prof.reply_hours_end as string).split(':').map(Number)
    const start = sh * 60 + sm
    const end = eh * 60 + em
    const inRange = start <= end ? (cur >= start && cur <= end) : (cur >= start || cur <= end)
    if (!inRange) {
      return { ok: false, reason: 'hours_outside', details: `${prof.reply_hours_start}~${prof.reply_hours_end}` }
    }
  }

  // 4) 스팸 패턴 — 같은 답안 N분 내 반복 발송 차단
  if (input.fanId) {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data: recent } = await sb
      .from('send_attempts')
      .select('draft_content')
      .eq('user_id', input.userId)
      .eq('fan_id', input.fanId)
      .gte('attempted_at', fiveMinAgo)
      .eq('status', 'sent')
    if (recent && recent.length > 0) {
      const same = recent.find((r) => r.draft_content === input.replyContent)
      if (same) return { ok: false, reason: 'spam_pattern', details: 'same content to same fan within 5min' }
    }
  }

  // 5) 글로벌 스팸 — 같은 답안 N명에게 빠르게 발송 차단
  const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString()
  const { count: sameRecentCount } = await sb
    .from('send_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', input.userId)
    .eq('draft_content', input.replyContent)
    .gte('attempted_at', oneMinAgo)
    .eq('status', 'sent')
  if ((sameRecentCount || 0) >= 3) {
    return { ok: false, reason: 'spam_pattern', details: `same content sent ${sameRecentCount} times in 1min` }
  }

  return { ok: true }
}

/**
 * Audit log — 모든 시도 기록
 */
export async function logSendAttempt(
  sb: SupabaseClient,
  input: {
    userId: string
    fanId: string | null
    channel: 'dm' | 'comment'
    draftContent: string
    status: 'sent' | 'blocked_window' | 'blocked_spam' | 'blocked_rate_limit'
      | 'blocked_content_filter' | 'blocked_hours' | 'queued' | 'failed'
    blockReason?: string
    rateLimitPct?: number
  }
) {
  await sb.from('send_attempts').insert({
    user_id: input.userId,
    fan_id: input.fanId,
    channel: input.channel,
    draft_content: input.draftContent,
    status: input.status,
    block_reason: input.blockReason || null,
    rate_limit_pct: input.rateLimitPct || null,
  })
}
