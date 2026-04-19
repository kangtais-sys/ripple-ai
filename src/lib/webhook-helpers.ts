// Webhook 처리 시 자동 누적되는 테이블들 (followers / outbound_messages / revenue_proposals)
// 와 reply_logs의 분류 컬럼 (urgency / sentiment) 을 채우는 헬퍼

import type { SupabaseClient } from '@supabase/supabase-js'

type AdminClient = SupabaseClient

// 비즈 DM 감지 키워드 (대소문자·한글 혼용)
const BIZ_KEYWORDS = [
  '협찬', '광고', '광고 문의', '제휴', '협업', '공동구매', '공구 문의',
  'OEM', 'odm', '유통', '수출', '브랜드 협업', '브랜드',
  '상품 협업', '제품 협찬', '협력', '입점', '세일즈',
  'partnership', 'collaboration', 'sponsor', 'amazon',
  '일본 수출', '중국 수출', '수출 문의', '도매',
  '견적', '단가', '수량', '납기',
]

const URGENT_KEYWORDS = ['환불', '반품', '불량', '피해', '문제', '오류', '결제', '고장', '트러블', '피부병', '배송 안 옴']
const NEGATIVE_KEYWORDS = ['싫어', '별로', '최악', '실망', '환불', '후회', '사기', '클레임']
const POSITIVE_KEYWORDS = ['좋아요', '대박', '최고', '감사', '예뻐요', '완전', '짱', '사랑', '행복', '멋져', '추천']

export function classifyText(text: string): {
  urgency: 'low' | 'medium' | 'high' | 'urgent'
  sentiment: 'positive' | 'neutral' | 'negative'
  isBizProposal: boolean
} {
  const lower = text.toLowerCase()
  const isBiz = BIZ_KEYWORDS.some(k => lower.includes(k.toLowerCase())) &&
                (text.length > 30 || /\d/.test(text)) // 최소 길이·숫자 포함하면 진짜 비즈일 확률 ↑

  const isUrgent = URGENT_KEYWORDS.some(k => text.includes(k))
  const negCount = NEGATIVE_KEYWORDS.filter(k => text.includes(k)).length
  const posCount = POSITIVE_KEYWORDS.filter(k => text.includes(k)).length

  let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral'
  if (negCount > posCount) sentiment = 'negative'
  else if (posCount > 0) sentiment = 'positive'

  let urgency: 'low' | 'medium' | 'high' | 'urgent' = 'low'
  if (isUrgent) urgency = 'urgent'
  else if (sentiment === 'negative') urgency = 'high'
  else if (isBiz) urgency = 'medium'

  return { urgency, sentiment, isBizProposal: isBiz }
}

export async function upsertFollower(
  admin: AdminClient,
  params: {
    userId: string
    platform: 'instagram' | 'tiktok' | 'youtube' | 'threads' | 'x' | 'other'
    handle: string
    kind: 'comment' | 'dm'
    sentiment?: 'positive' | 'neutral' | 'negative'
  }
) {
  try {
    // 이미 있으면 카운트·감정·타임스탬프 업데이트, 없으면 생성
    const { data: existing } = await admin
      .from('followers')
      .select('id, score, comment_count, dm_count, sentiment')
      .eq('user_id', params.userId)
      .eq('platform', params.platform)
      .eq('handle', params.handle)
      .maybeSingle()

    const now = new Date().toISOString()

    if (existing) {
      const update: Record<string, unknown> = {
        last_interaction_at: now,
      }
      if (params.kind === 'comment') update.comment_count = (existing.comment_count || 0) + 1
      if (params.kind === 'dm') update.dm_count = (existing.dm_count || 0) + 1
      // 감정은 더 자주 나오는 쪽으로 점진 업데이트 (단순히 최근 값으로)
      if (params.sentiment) update.sentiment = params.sentiment
      // 점수: 인터랙션마다 +1, 부정이면 -2
      const delta = params.sentiment === 'negative' ? -2 : 1
      update.score = (existing.score || 0) + delta
      await admin.from('followers').update(update).eq('id', existing.id)
    } else {
      await admin.from('followers').insert({
        user_id: params.userId,
        platform: params.platform,
        handle: params.handle,
        comment_count: params.kind === 'comment' ? 1 : 0,
        dm_count: params.kind === 'dm' ? 1 : 0,
        sentiment: params.sentiment || 'neutral',
        score: params.sentiment === 'negative' ? -2 : 1,
        tier: params.sentiment === 'negative' ? 'concern' : 'regular',
        last_interaction_at: now,
      })
    }
  } catch (e) {
    console.error('[webhook-helpers] upsertFollower failed', e)
  }
}

export async function recordOutboundMessage(
  admin: AdminClient,
  params: {
    userId: string
    platform: 'instagram' | 'tiktok' | 'youtube' | 'kakao' | 'email' | 'threads' | 'x'
    kind: 'comment_reply' | 'dm' | 'mention' | 'broadcast' | 'dm_rule'
    body: string
    recipientHandle?: string
    recipientPlatformId?: string
    status: 'sent' | 'failed' | 'queued'
    platformMessageId?: string
    errorMessage?: string
    sourceRefType?: string
    sourceRefId?: string
  }
) {
  try {
    await admin.from('outbound_messages').insert({
      user_id: params.userId,
      platform: params.platform,
      kind: params.kind,
      recipient_handle: params.recipientHandle || null,
      recipient_platform_id: params.recipientPlatformId || null,
      source_ref_type: params.sourceRefType || null,
      source_ref_id: params.sourceRefId || null,
      body: params.body,
      status: params.status,
      error_message: params.errorMessage || null,
      platform_message_id: params.platformMessageId || null,
      sent_at: params.status === 'sent' ? new Date().toISOString() : null,
    })
  } catch (e) {
    console.error('[webhook-helpers] recordOutboundMessage failed', e)
  }
}

export async function maybeCreateRevenueProposal(
  admin: AdminClient,
  params: {
    userId: string
    sourceChannel: 'instagram_dm' | 'email' | 'web_form' | 'tiktok_dm' | 'youtube_comment' | 'link_proposal' | 'other'
    fromPlatformId?: string
    fromHandle?: string
    text: string
  }
): Promise<boolean> {
  const { isBizProposal } = classifyText(params.text)
  if (!isBizProposal) return false
  try {
    await admin.from('revenue_proposals').insert({
      user_id: params.userId,
      source_channel: params.sourceChannel,
      from_name: params.fromHandle || null,
      from_platform_id: params.fromPlatformId || null,
      original_text: params.text,
      status: 'new',
    })
    return true
  } catch (e) {
    console.error('[webhook-helpers] maybeCreateRevenueProposal failed', e)
    return false
  }
}
