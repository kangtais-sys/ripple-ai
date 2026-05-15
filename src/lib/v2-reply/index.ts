// v2 응대 엔진 — 통합 진입점
//
// handleInboundMessage:
//   1. 의도 분류 (4-way)
//   2. RAG 검색 + Claude 응답 생성
//   3. 안전 체크 (24h 창 + 스팸 + 금지 콘텐츠 + 시간대)
//   4. reply_mode 분기:
//      - 'draft' 또는 urgent → pending_replies 큐 + 솔라피 알림톡
//      - 'auto' → 즉시 발송 (IG Graph API)
//   5. conversations + send_attempts 기록

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyIntent } from './intent'
import { generateReply } from './generate'
import { checkSafety, logSendAttempt } from './safety'

export interface InboundMessage {
  userId: string
  channel: 'dm' | 'comment'
  igMessageId?: string
  igCommentId?: string
  igMediaId?: string
  fromIgUserId: string
  fromUsername?: string
  content: string
}

export interface ProcessResult {
  ok: boolean
  action: 'sent' | 'queued_pending' | 'queued_hours' | 'skipped' | 'failed'
  pendingReplyId?: string
  conversationId?: string
  fanId?: string
  reply?: string
  error?: string
  intent?: string
  context_tier?: string
}

function genApprovalToken(): string {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 32; i++) s += a[Math.floor(Math.random() * a.length)]
  return s
}

/**
 * Inbound 메시지 (댓글·DM) 받아 응대 처리.
 * v2 모드 (knowledge_chunks 있고 profiles.reply_mode 활성화) 인 사용자만 사용.
 */
export async function handleInboundMessage(
  sb: SupabaseClient,
  msg: InboundMessage,
): Promise<ProcessResult> {
  // 0) 사용자 v2 활성화 체크 — knowledge_chunks 있어야 v2
  const { count: kbCount } = await sb
    .from('knowledge_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', msg.userId)
    .eq('is_active', true)
  if (!kbCount || kbCount === 0) {
    return { ok: false, action: 'skipped', error: 'v2_not_ready_no_kb' }
  }

  // 1) fan_profiles upsert
  const { data: fanRow } = await sb
    .from('fan_profiles')
    .upsert({
      user_id: msg.userId,
      ig_user_id: msg.fromIgUserId,
      ig_username: msg.fromUsername || null,
      last_seen_at: new Date().toISOString(),
      window_expires_at: msg.channel === 'dm'
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : null,
    }, { onConflict: 'user_id,ig_user_id' })
    .select('id, is_vip, conversation_count, window_expires_at')
    .single()

  if (!fanRow) return { ok: false, action: 'failed', error: 'fan_upsert_failed' }
  const fanId = fanRow.id

  // 2) 의도 분류
  const intent = await classifyIntent(msg.content)

  // 3) inbound conversation 기록
  const { data: convRow } = await sb
    .from('conversations')
    .insert({
      user_id: msg.userId,
      fan_id: fanId,
      channel: msg.channel,
      direction: 'inbound',
      content: msg.content,
      intent: intent.intent,
      sentiment: intent.sentiment,
      is_urgent: intent.is_urgent,
      ig_message_id: msg.igMessageId || null,
      ig_comment_id: msg.igCommentId || null,
      ig_media_id: msg.igMediaId || null,
    })
    .select('id')
    .single()
  const conversationId = convRow?.id

  // 4) Claude 응답 생성 (RAG + 차등 컨텍스트)
  let result
  try {
    result = await generateReply(sb, {
      userId: msg.userId,
      fanId,
      message: msg.content,
      channel: msg.channel,
      intent,
    })
  } catch (e) {
    return {
      ok: false,
      action: 'failed',
      error: e instanceof Error ? e.message : 'generate_failed',
      intent: intent.intent,
    }
  }

  // 5) 안전 체크
  const safety = await checkSafety(sb, {
    userId: msg.userId,
    fanId,
    fanWindowExpiresAt: fanRow.window_expires_at,
    replyContent: result.reply,
    channel: msg.channel,
  })

  if (!safety.ok) {
    await logSendAttempt(sb, {
      userId: msg.userId,
      fanId,
      channel: msg.channel,
      draftContent: result.reply,
      status: `blocked_${safety.reason}` as 'blocked_window' | 'blocked_spam' | 'blocked_content_filter' | 'blocked_hours' | 'blocked_rate_limit',
      blockReason: safety.details,
    })
    // 시간대 외 → 큐 (창 만료 안 됐으면 시간 되면 발송 cron 처리)
    if (safety.reason === 'hours_outside' && msg.channel === 'dm') {
      // pending_replies 에 hours queue 로 저장
      const token = genApprovalToken()
      await sb.from('pending_replies').insert({
        user_id: msg.userId,
        fan_id: fanId,
        conversation_id: conversationId,
        channel: msg.channel,
        original_message: msg.content,
        original_message_id: msg.igMessageId || msg.igCommentId || '',
        ai_draft: result.reply,
        intent: intent.intent,
        approval_token: token,
        window_expires_at: fanRow.window_expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        status: 'pending',
      })
      return { ok: true, action: 'queued_hours', intent: intent.intent, context_tier: result.context_tier }
    }
    return {
      ok: false,
      action: 'skipped',
      error: `safety_${safety.reason}`,
      intent: intent.intent,
    }
  }

  // 6) reply_mode 분기 — draft 모드면 pending_replies + 솔라피
  const { data: prof } = await sb
    .from('profiles')
    .select('reply_mode, draft_mode_until')
    .eq('id', msg.userId)
    .single()

  const isDraftMode =
    prof?.reply_mode === 'draft' ||
    (prof?.draft_mode_until && new Date(prof.draft_mode_until as string) > new Date())

  // 긴급 또는 draft 모드 → pending_replies + 솔라피 알림 발송
  if (isDraftMode || intent.is_urgent) {
    const token = genApprovalToken()
    const { data: pendingRow } = await sb
      .from('pending_replies')
      .insert({
        user_id: msg.userId,
        fan_id: fanId,
        conversation_id: conversationId,
        channel: msg.channel,
        original_message: msg.content,
        original_message_id: msg.igMessageId || msg.igCommentId || '',
        ai_draft: result.reply,
        intent: intent.intent,
        approval_token: token,
        window_expires_at: fanRow.window_expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        status: 'pending',
      })
      .select('id, approval_token')
      .single()

    // 솔라피 알림톡 발송 (env 있을 때만, 별도 함수에서 처리)
    if (process.env.SOLAPI_API_KEY && pendingRow) {
      // 알림톡 비동기 — 응대 흐름 막지 않게 fire-and-forget
      const { sendApprovalAlert } = await import('@/lib/v2-reply/alert')
      sendApprovalAlert(sb, msg.userId, pendingRow.id, pendingRow.approval_token).catch((e) => {
        console.error('[v2-reply] alert failed:', e)
      })
    }

    return {
      ok: true,
      action: 'queued_pending',
      pendingReplyId: pendingRow?.id,
      conversationId,
      fanId,
      reply: result.reply,
      intent: intent.intent,
      context_tier: result.context_tier,
    }
  }

  // 7) auto 모드 — 즉시 IG Graph API 호출
  const { data: igAcc } = await sb
    .from('ig_accounts')
    .select('access_token, ig_user_id')
    .eq('user_id', msg.userId)
    .maybeSingle()

  if (!igAcc?.access_token) {
    await logSendAttempt(sb, {
      userId: msg.userId, fanId, channel: msg.channel,
      draftContent: result.reply, status: 'failed', blockReason: 'no_ig_token',
    })
    return { ok: false, action: 'failed', error: 'no_ig_token', intent: intent.intent }
  }

  const { sendCommentReply, sendDirectMessage } = await import('@/lib/v2-reply/send')
  const sendResult = msg.channel === 'comment'
    ? await sendCommentReply(igAcc.access_token, msg.igCommentId || '', result.reply)
    : await sendDirectMessage(igAcc.access_token, msg.fromIgUserId, result.reply)

  if (!sendResult.ok) {
    await logSendAttempt(sb, {
      userId: msg.userId, fanId, channel: msg.channel,
      draftContent: result.reply, status: 'failed', blockReason: sendResult.error,
    })
    return { ok: false, action: 'failed', error: sendResult.error, intent: intent.intent }
  }

  // 성공 — outbound conversation 기록
  await sb.from('conversations').insert({
    user_id: msg.userId,
    fan_id: fanId,
    channel: msg.channel,
    direction: 'outbound',
    content: result.reply,
    ai_drafted: true,
    is_approved: true,
    approved_by_user: false,
    ig_message_id: msg.channel === 'dm' ? sendResult.id : null,
    ig_comment_id: msg.channel === 'comment' ? sendResult.id : null,
  })

  await logSendAttempt(sb, {
    userId: msg.userId,
    fanId,
    channel: msg.channel,
    draftContent: result.reply,
    status: 'sent',
  })

  // 팬 카운터 증가
  await sb.rpc('increment_fan_counter', {
    p_fan_id: fanId,
    p_channel: msg.channel,
  }).then(() => {}, () => {
    // RPC 없을 수 있음 — 무시
  })

  return {
    ok: true,
    action: 'sent',
    conversationId,
    fanId,
    reply: result.reply,
    intent: intent.intent,
    context_tier: result.context_tier,
  }
}
